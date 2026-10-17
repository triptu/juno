/**
 * `AiProvider` over pi-ai and OpenRouter. The key comes from the config in
 * memory; nothing here reads disk or env.
 *
 * A decision task with a classifier mapping goes to the decision model
 * (System One API) when the classifier slug is set. Every other structured task
 * is one tool call whose parameters are the task's output schema: forced on the
 * decision tier, asked for by instruction (tool choice auto) on the generation
 * tier, where some models reject a forced choice. Answers are validated,
 * retried once, and otherwise the result is no decision. A provider error is
 * sorted into a kind (`failure.ts`) and retried only when trying again can
 * help. When a chat model refuses under its own policy or is unavailable, the
 * fallback model, from another maker, is asked once, with its own
 * reservation. Every failure is a value.
 */
import {
  hasApi,
  type Api,
  type AssistantMessage,
  type Context as PiContext,
  type Message as PiMessage,
  type Model,
  type Static,
  type Tool,
  type TSchema,
} from '@earendil-works/pi-ai'
import { Effect, Layer, Option } from 'effect'
import { classifierFor, fallbackFor, modelFor, type AiConfig, type Tier } from '../config'
import { classifyFailure, fallbackHelps, isRetryable, type AiFailureKind } from '@juno/ai-failure'
import { AiProvider, type AiCallMeta, type AiProviderShape, type Decision, type NoDecisionReason } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import { OPENROUTER, openRouterModels, resolveClassifier, resolveModel, type PiModels, type ResolvedModel } from './models'

import { admitted, attemptBounds, type Progress } from './spend'

export { OPENROUTER, openRouterModels, type PiModels } from './models'
export { upperUsd } from './spend'

const DECISION_MAX_TOKENS = 1024
const GENERATION_MAX_TOKENS = 2048
/** A drawing is 400 to 900 bytes, but a reasoning model spends most of its output thinking before it (median 600 to 1,000 tokens). */
const ART_MAX_TOKENS = 4096
/** The output cap of a request per tier, which bounds what it can cost. */
export const MAX_TOKENS: Record<Tier, number> = { decision: DECISION_MAX_TOKENS, generation: GENERATION_MAX_TOKENS, art: ART_MAX_TOKENS }
/** A fallback with less of the task's time left than this is not asked: it could not answer in time. */
const FALLBACK_MIN_MILLIS = 500

type Outcome<A> =
  | { readonly kind: 'ok'; readonly value: A }
  /** `raw` is the answer that failed, so a retry can show it back with the reason. `failure` sorts a provider error. */
  | { readonly kind: NoDecisionReason; readonly detail?: string; readonly raw?: string; readonly failure?: AiFailureKind }

/** How the tool call is asked for. `forced` is fastest; `auto` relies on the prompt's "answer by calling the tool". */
export type ToolChoiceMode = 'forced' | 'auto'

interface Request<A> {
  readonly model: Model<Api>
  readonly context: PiContext
  readonly tool?: Tool
  readonly toolChoice: ToolChoiceMode
  readonly maxTokens: number
  readonly read: (message: AssistantMessage) => Outcome<A>
  /** When set, a retry after invalid output continues the conversation: the failed answer, then this message with the reason. */
  readonly retry?: ((reason: string) => string) | undefined
}

/** What the attempts of one call used, added up as they finish. */
interface Usage {
  usd: number
  input: number
  output: number
}

/** One decision: up to two attempts inside the task's timeout, then a `Decision` with its meta. */
interface Call<A> {
  readonly modelId: string
  readonly priced: boolean
  readonly timeoutMillis: number
  readonly maxAttempts?: number
  readonly started: number
  /** Counts the attempts started, so a call stopped part way can settle what it may have cost. */
  readonly progress?: Progress
  /** One attempt. `previous` is the failed first attempt, so the retry can change shape. */
  readonly attempt: (previous: Outcome<A> | undefined, usage: Usage) => Effect.Effect<Outcome<A>>
}

/** The provider said the model does not take a forced tool choice. The retry then asks with `auto`. */
function rejectsForcedToolChoice(outcome: Outcome<unknown> | undefined): boolean {
  return outcome?.kind === 'provider-error' && outcome.detail !== undefined && /tool_choice/i.test(outcome.detail)
}

/** A provider error as an outcome, with its kind. */
function providerError<A>(detail: string | undefined): Outcome<A> {
  return { kind: 'provider-error', ...(detail === undefined ? {} : { detail }), failure: classifyFailure(detail ?? '') }
}

/** Whether a failed first attempt gets a second: invalid output, a retryable provider error, or a forced tool choice the model rejects. */
function worthRetry(first: Outcome<unknown>): boolean {
  if (first.kind === 'invalid-output') return true
  if (first.kind !== 'provider-error') return false
  return rejectsForcedToolChoice(first) || isRetryable(first.failure ?? 'unknown')
}

/**
 * The least reasoning an OpenAI-compatible model allows. pi-ai sends "none" when
 * the model can turn reasoning off; when it cannot, the lowest level is the one to ask for.
 */
export function lowestReasoningEffort(model: Model<Api>): 'minimal' | 'low' | undefined {
  if (!model.reasoning) return undefined
  const map = model.thinkingLevelMap
  if (map === undefined || map.off !== null) return undefined
  return map.minimal !== null && map.minimal !== undefined ? 'minimal' : 'low'
}

export class PiAiProvider extends AiProvider {
  /** `config` is read on every call, so a key or a model added later is picked up without a restart. */
  static readonly layer = (config: Effect.Effect<AiConfig>, models: PiModels = openRouterModels()): Layer.Layer<AiProvider> =>
    Layer.succeed(AiProvider, makePiAiProvider(config, models))
}

export function makePiAiProvider(readConfig: Effect.Effect<AiConfig>, models: PiModels): AiProviderShape {
  const complete = (request: Request<unknown>, apiKey: string, toolChoice: ToolChoiceMode, context: PiContext) =>
    Effect.tryPromise((signal) => {
      const { model, tool, maxTokens } = request
      const base = { apiKey, signal, maxTokens, maxRetries: 0 }
      if (hasApi(model, 'anthropic-messages')) {
        return models.complete(model, context, {
          ...base,
          thinkingEnabled: false,
          ...(tool ? { toolChoice: toolChoice === 'forced' ? { type: 'tool', name: tool.name } : 'auto' } : {}),
        })
      }
      if (hasApi(model, 'openai-completions')) {
        const reasoningEffort = lowestReasoningEffort(model)
        return models.complete(model, context, {
          ...base,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(tool ? { toolChoice: toolChoice === 'forced' ? { type: 'function', function: { name: tool.name } } : 'auto' } : {}),
        })
      }
      return models.complete(model, context, base)
    })

  /** One chat request, read into an outcome. Rejections and error stops are provider errors. */
  const chatAttempt =
    <A>(request: Request<A>, apiKey: string): Call<A>['attempt'] =>
    (previous, usage) =>
      Effect.gen(function* () {
        const toolChoice = rejectsForcedToolChoice(previous) ? 'auto' : request.toolChoice
        const result = yield* Effect.result(complete(request, apiKey, toolChoice, retryContext(request, previous)))
        if (result._tag === 'Failure') return providerError<A>(String(result.failure.cause))
        const message = result.success
        usage.usd += message.usage.cost.total
        usage.input += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite
        usage.output += message.usage.output
        if (message.stopReason === 'error') return providerError<A>(message.errorMessage)
        if (message.stopReason === 'aborted') return { kind: 'timeout' } as Outcome<A>
        return request.read(message)
      })

  /** One classifier request: the task's questions over its state, the answers read back as the output. */
  const classifyAttempt =
    <I, S extends TSchema>(task: StructuredTask<I, S>, input: I, model: ReturnType<typeof resolveClassifier>['model'], apiKey: string): Call<Static<S>>['attempt'] =>
    (_previous, usage) =>
      Effect.gen(function* () {
        const mapping = task.classify!
        const result = yield* Effect.result(Effect.tryPromise((signal) => models.classify(model, mapping.ask(input), { apiKey, signal, maxRetries: 0 })))
        if (result._tag === 'Failure') return providerError<Static<S>>(String(result.failure.cause))
        const answer = result.success
        usage.usd += answer.usage?.cost.total ?? 0
        usage.input += (answer.usage?.input ?? 0) + (answer.usage?.cacheRead ?? 0) + (answer.usage?.cacheWrite ?? 0)
        usage.output += answer.usage?.output ?? 0
        if (answer.stopReason === 'error') return providerError<Static<S>>(answer.errorMessage)
        if (answer.stopReason === 'aborted') return { kind: 'timeout' } as Outcome<Static<S>>
        const checked = validateOutput(task, input, mapping.read(answer.answers, input))
        return checked.ok ? { kind: 'ok', value: checked.value } : { kind: 'invalid-output', detail: checked.message }
      })

  const decide: AiProviderShape['decide'] = <I, S extends TSchema>(task: StructuredTask<I, S>, input: I) =>
    Effect.gen(function* () {
      const started = Date.now()
      const config = yield* readConfig
      const classifierSlug = task.tier === 'decision' && task.classify ? classifierFor(config) : undefined
      if (classifierSlug !== undefined) {
        const { model, priced } = resolveClassifier(models, classifierSlug)
        if (!config.apiKey) return noKey(model.id, started)
        const apiKey = config.apiKey
        const bounds = attemptBounds(model.cost, priced, JSON.stringify(task.classify!.ask(input)), DECISION_MAX_TOKENS)
        return yield* admitted(config, model.id, priced, bounds, (progress) =>
          run<Static<S>>({ progress, modelId: model.id, priced, timeoutMillis: task.timeoutMillis, maxAttempts: task.maxAttempts, started, attempt: classifyAttempt(task, input, model, apiKey) }))
      }
      const main = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(main.model.id, started)
      const apiKey = config.apiKey
      const tool: Tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
      const call = ({ model, priced }: ResolvedModel, timeoutMillis: number, from: number) => {
        const request: Request<Static<S>> = {
          model,
          tool,
          toolChoice: task.tier === 'decision' ? 'forced' : 'auto',
          maxTokens: task.maxTokens ?? (task.tier === 'decision' ? DECISION_MAX_TOKENS : GENERATION_MAX_TOKENS),
          context: { systemPrompt: task.prompt, messages: [userMessage(task.render(input))], tools: [tool] },
          read: (message) => {
            const call = message.content.find((c) => c.type === 'toolCall' && c.name === tool.name)
            if (!call || call.type !== 'toolCall') return { kind: 'invalid-output', detail: 'the model did not call the tool' }
            const checked = validateOutput(task, input, call.arguments)
            return checked.ok ? { kind: 'ok', value: checked.value } : { kind: 'invalid-output', detail: checked.message }
          },
        }
        return admitted(config, model.id, priced, attemptBounds(model.cost, priced, JSON.stringify(request.context), request.maxTokens), (progress) =>
          run<Static<S>>({ progress, modelId: model.id, priced, timeoutMillis, maxAttempts: task.maxAttempts, started: from, attempt: chatAttempt(request, apiKey) }))
      }
      return yield* withFallback(config, main, task, started, call)
    })

  const generate: AiProviderShape['generate'] = <I>(task: TextTask<I>, input: I) =>
    Effect.gen(function* () {
      const started = Date.now()
      const config = yield* readConfig
      const main = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(main.model.id, started)
      const apiKey = config.apiKey
      const call = ({ model, priced }: ResolvedModel, timeoutMillis: number, from: number) => {
        const request: Request<string> = {
          model,
          toolChoice: 'auto',
          maxTokens: task.tier === 'art' ? ART_MAX_TOKENS : GENERATION_MAX_TOKENS,
          context: { systemPrompt: task.prompt, messages: [userMessage(task.render(input))] },
          retry: task.retry,
          read: (message) => {
            const raw = textOf(message)
            const text = cleanText(task, raw)
            if (text === undefined) return { kind: 'invalid-output', detail: 'empty answer', raw }
            if (task.check === undefined) return { kind: 'ok', value: text }
            const checked = task.check(text, input)
            return checked.ok ? { kind: 'ok', value: checked.value } : { kind: 'invalid-output', detail: checked.message, raw }
          },
        }
        return admitted(config, model.id, priced, attemptBounds(model.cost, priced, JSON.stringify(request.context), request.maxTokens), (progress) =>
          run<string>({ progress, modelId: model.id, priced, timeoutMillis, maxAttempts: task.maxAttempts, started: from, attempt: chatAttempt(request, apiKey) }))
      }
      // Art is drawn by a model chosen for it; another maker's drawing is not asked for.
      return yield* (task.tier === 'art' ? call(main, task.timeoutMillis, started) : withFallback(config, main, task, started, call))
    })

  /**
   * The main model's call, then, when it failed in a way another maker's
   * model may not (a policy refusal, the model not found or unavailable),
   * one call to the fallback in the time the task has left. The fallback's
   * answer carries the failed call in `fallbackFor`, so the log shows both.
   */
  const withFallback = <A>(
    config: AiConfig,
    main: ResolvedModel,
    task: { readonly timeoutMillis: number },
    started: number,
    call: (model: ResolvedModel, timeoutMillis: number, from: number) => Effect.Effect<Decision<A>>,
  ): Effect.Effect<Decision<A>> =>
    Effect.gen(function* () {
      const first = yield* call(main, task.timeoutMillis, started)
      if (first._tag === 'Decided' || first.reason !== 'provider-error' || first.kind === undefined || !fallbackHelps(first.kind)) return first
      const slug = fallbackFor(config, main.model.id)
      const left = task.timeoutMillis - (Date.now() - started)
      if (slug === undefined || left < FALLBACK_MIN_MILLIS) return first
      const from = Date.now()
      const second = yield* call(resolveModel(models, slug), left, from)
      const failed = { meta: first.meta, kind: first.kind, ...(first.detail === undefined ? {} : { detail: first.detail }) }
      return { ...second, meta: { ...second.meta, fallbackFor: failed } }
    })

  return { decide, generate }
}

/** Two attempts at most, inside the task's timeout. */
function run<A>(call: Call<A>): Effect.Effect<Decision<A>> {
  return Effect.gen(function* () {
    const usage: Usage = { usd: 0, input: 0, output: 0 }
    let attempts = 0
    const once = (previous: Outcome<A> | undefined) =>
      Effect.suspend(() => {
        attempts++
        if (call.progress !== undefined) call.progress.attempts = attempts
        return call.attempt(previous, usage)
      })
    const twice = Effect.gen(function* () {
      const first = yield* once(undefined)
      if (call.maxAttempts === 1 || first.kind === 'ok' || !worthRetry(first)) return first
      return yield* once(first)
    })
    const outcome = yield* Effect.timeoutOption(twice, call.timeoutMillis)
    const meta: AiCallMeta = {
      model: call.modelId,
      latencyMillis: Date.now() - call.started,
      attempts,
      ...(call.priced ? { costUsd: usage.usd } : {}),
      ...(usage.input + usage.output > 0 ? { inputTokens: usage.input, outputTokens: usage.output } : {}),
    }
    if (Option.isNone(outcome)) return { _tag: 'NoDecision', reason: 'timeout', meta }
    const value = outcome.value
    if (value.kind === 'ok') return { _tag: 'Decided', value: value.value, meta }
    return { _tag: 'NoDecision', reason: value.kind, detail: value.detail, ...(value.failure === undefined ? {} : { kind: value.failure }), meta }
  })
}

/**
 * The context of an attempt. After invalid output, a task with a retry
 * message continues the conversation (the failed answer, then the reason),
 * so the model corrects one thing instead of starting over.
 */
function retryContext<A>(request: Request<A>, previous: Outcome<A> | undefined): PiContext {
  if (request.retry === undefined || previous === undefined || previous.kind !== 'invalid-output' || previous.raw === undefined) return request.context
  const assistant: PiMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: previous.raw }],
    api: request.model.api,
    provider: OPENROUTER,
    model: request.model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
  return { ...request.context, messages: [...request.context.messages, assistant, userMessage(request.retry(previous.detail ?? 'the answer did not validate'))] }
}

function noKey(model: string, started: number): Decision<never> {
  return { _tag: 'NoDecision', reason: 'missing-key', meta: { model, latencyMillis: Date.now() - started, attempts: 0 } }
}

function userMessage(text: string): PiMessage {
  return { role: 'user', content: text, timestamp: Date.now() }
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
}
