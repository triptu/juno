/**
 * `AiProvider` over pi-ai and OpenRouter. The key comes from the config in
 * memory; nothing here reads disk or env.
 *
 * A decision task with a classifier mapping goes to the decision model
 * (System One API) when the classifier slug is set. Every other structured task
 * is one tool call whose parameters are the task's output schema: forced on the
 * decision tier, asked for by instruction (tool choice auto) on the generation
 * tier, where some models reject a forced choice. Answers are validated,
 * retried once, and otherwise the result is no decision. Every failure is a value.
 */
import {
  hasApi,
  type Api,
  type AssistantMessage,
  type Context as PiContext,
  type Message as PiMessage,
  type Model,
  type ModelCost,
  type Static,
  type Tool,
  type TSchema,
} from '@earendil-works/pi-ai'
import { Effect, Layer, Option } from 'effect'
import { classifierFor, modelFor, type AiConfig, type Tier } from '../config'
import { AiProvider, type AiCallMeta, type AiProviderShape, type Decision, type NoDecisionReason } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import { OPENROUTER, openRouterModels, resolveClassifier, resolveModel, type PiModels } from './models'

export { OPENROUTER, openRouterModels, type PiModels } from './models'

const DECISION_MAX_TOKENS = 1024
const GENERATION_MAX_TOKENS = 2048
/** A drawing is 400 to 900 bytes, but a reasoning model spends most of its output thinking before it (median 600 to 1,000 tokens). */
const ART_MAX_TOKENS = 4096
/** The output cap of a request per tier, which bounds what it can cost. */
export const MAX_TOKENS: Record<Tier, number> = { decision: DECISION_MAX_TOKENS, generation: GENERATION_MAX_TOKENS, art: ART_MAX_TOKENS }
/** A slug outside pi-ai's price table reserves this much per call and settles as unknown, so it still counts against the cap. */
const UNPRICED_RESERVATION_USD = 0.05
/** Tokens of framing per message, as in the agent's bound (`@juno/agent-memory` `upper`). */
const FRAMING_TOKENS = 64
/** Room for a retry's message with the checker's reason. */
const RETRY_MESSAGE_BYTES = 2048

type Outcome<A> =
  | { readonly kind: 'ok'; readonly value: A }
  /** `raw` is the answer that failed, so a retry can show it back with the reason. */
  | { readonly kind: NoDecisionReason; readonly detail?: string; readonly raw?: string }

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

/** How far a call got: the attempts started so far. */
interface Progress {
  attempts: number
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
        if (result._tag === 'Failure') return { kind: 'provider-error', detail: String(result.failure.cause) } as Outcome<A>
        const message = result.success
        usage.usd += message.usage.cost.total
        usage.input += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite
        usage.output += message.usage.output
        if (message.stopReason === 'error') return { kind: 'provider-error', detail: message.errorMessage } as Outcome<A>
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
        if (result._tag === 'Failure') return { kind: 'provider-error', detail: String(result.failure.cause) } as Outcome<Static<S>>
        const answer = result.success
        usage.usd += answer.usage?.cost.total ?? 0
        usage.input += (answer.usage?.input ?? 0) + (answer.usage?.cacheRead ?? 0) + (answer.usage?.cacheWrite ?? 0)
        usage.output += answer.usage?.output ?? 0
        if (answer.stopReason === 'error') return { kind: 'provider-error', detail: answer.errorMessage } as Outcome<Static<S>>
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
      const { model, priced } = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(model.id, started)
      const apiKey = config.apiKey
      const tool: Tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
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
      return yield* admitted(config, model.id, priced, attemptBounds(model.cost, priced, JSON.stringify(request.context), request.maxTokens), (progress) =>
        run<Static<S>>({ progress, modelId: model.id, priced, timeoutMillis: task.timeoutMillis, maxAttempts: task.maxAttempts, started, attempt: chatAttempt(request, apiKey) }))
    })

  const generate: AiProviderShape['generate'] = <I>(task: TextTask<I>, input: I) =>
    Effect.gen(function* () {
      const started = Date.now()
      const config = yield* readConfig
      const { model, priced } = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(model.id, started)
      const apiKey = config.apiKey
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
      return yield* admitted(config, model.id, priced, attemptBounds(model.cost, priced, JSON.stringify(request.context), request.maxTokens), (progress) =>
        run<string>({ progress, modelId: model.id, priced, timeoutMillis: task.timeoutMillis, maxAttempts: task.maxAttempts, started, attempt: chatAttempt(request, apiKey) }))
    })

  return { decide, generate }
}

/**
 * The most a call's two attempts can cost: every input byte as a token at the
 * dearest input rate, the retry's copy of the first answer and its message,
 * and both outputs at the cap. Rounded up by the ledger.
 */
export function upperUsd(cost: ModelCost, priced: boolean, input: string, maxTokens: number): number {
  return attemptBounds(cost, priced, input, maxTokens).total
}

/** The most each attempt of a call can cost, and both together (`upperUsd`). */
export interface AttemptBounds {
  readonly first: number
  readonly total: number
}

export function attemptBounds(cost: ModelCost, priced: boolean, input: string, maxTokens: number): AttemptBounds {
  if (!priced) return { first: UNPRICED_RESERVATION_USD, total: UNPRICED_RESERVATION_USD }
  const rates = [cost, ...(cost.tiers ?? [])]
  const inputRate = Math.max(...rates.flatMap((rate) => [rate.input, rate.cacheRead, rate.cacheWrite]))
  const outputRate = Math.max(...rates.map((rate) => rate.output))
  const first = new TextEncoder().encode(input).length + 2 * FRAMING_TOKENS
  const retry = first + 4 * maxTokens + RETRY_MESSAGE_BYTES + 2 * FRAMING_TOKENS
  return {
    first: (first * inputRate + maxTokens * outputRate) / 1_000_000,
    total: ((first + retry) * inputRate + 2 * maxTokens * outputRate) / 1_000_000,
  }
}

/** A 401, 403 or 429 comes before any output, so nothing was billed for that attempt. */
function refusedBeforeOutput(detail: string | undefined): boolean {
  if (detail === undefined) return false
  return /^(401|403|429)\b/.test(detail) || /\((401|403|429)\):/.test(detail) || /rate.?limit/i.test(detail)
}

/**
 * What to settle: the reported cost when it is known. A call that ended in
 * its first attempt without a report (a timeout, a lost request) never sent
 * the retry, so it settles at the first attempt's bound, which is at least
 * what it can have been billed. Otherwise `undefined`, which keeps the
 * whole reservation.
 */
export function settledUsd<A>(decision: Decision<A>, priced: boolean, bounds: AttemptBounds): number | undefined {
  if (!priced) return undefined
  if (decision._tag === 'Decided' || decision.reason === 'invalid-output') return decision.meta.costUsd
  if (decision.reason === 'provider-error' && refusedBeforeOutput(decision.detail)) return decision.meta.costUsd ?? 0
  if ((decision.reason === 'timeout' || decision.reason === 'provider-error') && decision.meta.attempts === 1) return bounds.first
  return undefined
}

/**
 * What to settle for a call stopped before it ended (its job restarted, the
 * key changed, the app quit). Before any attempt nothing was sent. In the
 * first attempt the retry was never sent, so the first attempt's bound is at
 * least what it can have been billed, as for a timeout. Later, `undefined`
 * keeps the whole reservation.
 */
export function stoppedUsd(priced: boolean, bounds: AttemptBounds, attempts: number): number | undefined {
  if (attempts === 0) return 0
  if (!priced) return undefined
  return attempts === 1 ? bounds.first : undefined
}

/** Reserves the call's upper cost when the config has a cap, and settles it however the call ends. */
function admitted<A>(config: AiConfig, modelId: string, priced: boolean, bounds: AttemptBounds, call: (progress: Progress) => Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> {
  const admit = config.admit
  const progress: Progress = { attempts: 0 }
  if (admit === undefined) return call(progress)
  return Effect.gen(function* () {
    const started = Date.now()
    const admission = yield* admit(bounds.total)
    if (admission._tag === 'Blocked') return { _tag: 'NoDecision', reason: 'budget', detail: admission.reason ?? 'cap', meta: { model: modelId, latencyMillis: Date.now() - started, attempts: 0 } } as Decision<A>
    return yield* call(progress).pipe(Effect.onExit((exit) =>
      admission.settle(exit._tag === 'Success' ? settledUsd(exit.value, priced, bounds) : stoppedUsd(priced, bounds, progress.attempts))))
  })
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
      if (call.maxAttempts === 1 || first.kind === 'ok' || first.kind === 'timeout') return first
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
    return { _tag: 'NoDecision', reason: value.kind, detail: value.detail, meta }
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
