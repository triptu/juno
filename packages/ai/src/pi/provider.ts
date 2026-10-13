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
  validateToolCall,
  type Api,
  type AssistantMessage,
  type Context as PiContext,
  type Message as PiMessage,
  type Model,
  type Static,
  type Tool,
  type TSchema,
} from '@earendil-works/pi-ai'
import { Effect, Layer, Option, Queue, Stream } from 'effect'
import { classifierFor, modelFor, type AiConfig } from '../config'
import { AiProvider, type AiCallMeta, type AiProviderShape, type ChatContext, type ChatEvent, type ChatTool, type ChatToolCall, type Decision, type NoDecisionReason } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import { chat as chatTask } from '../tasks/chat'
import { OPENROUTER, openRouterModels, resolveClassifier, resolveModel, type PiModels } from './models'

export { OPENROUTER, openRouterModels, resolveClassifier, resolveModel, type PiModels } from './models'

const DECISION_MAX_TOKENS = 1024
const GENERATION_MAX_TOKENS = 2048

type Outcome<A> =
  | { readonly kind: 'ok'; readonly value: A }
  | { readonly kind: NoDecisionReason; readonly detail?: string }

/** How the tool call is asked for. `forced` is fastest; `auto` relies on the prompt's "answer by calling the tool". */
export type ToolChoiceMode = 'forced' | 'auto'

interface Request<A> {
  readonly model: Model<Api>
  readonly context: PiContext
  readonly tool?: Tool
  readonly toolChoice: ToolChoiceMode
  readonly maxTokens: number
  readonly read: (message: AssistantMessage) => Outcome<A>
}

/** One decision: up to two attempts inside the task's timeout, then a `Decision` with its meta. */
interface Call<A> {
  readonly modelId: string
  readonly priced: boolean
  readonly timeoutMillis: number
  readonly started: number
  /** One attempt. `previous` is the failed first attempt, so the retry can change shape. */
  readonly attempt: (previous: Outcome<A> | undefined, cost: { usd: number }) => Effect.Effect<Outcome<A>>
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
  const complete = (request: Request<unknown>, apiKey: string, toolChoice: ToolChoiceMode) =>
    Effect.tryPromise((signal) => {
      const { model, context, tool, maxTokens } = request
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
    (previous, cost) =>
      Effect.gen(function* () {
        const toolChoice = rejectsForcedToolChoice(previous) ? 'auto' : request.toolChoice
        const result = yield* Effect.result(complete(request, apiKey, toolChoice))
        if (result._tag === 'Failure') return { kind: 'provider-error', detail: String(result.failure.cause) } as Outcome<A>
        const message = result.success
        cost.usd += message.usage.cost.total
        if (message.stopReason === 'error') return { kind: 'provider-error', detail: message.errorMessage } as Outcome<A>
        if (message.stopReason === 'aborted') return { kind: 'timeout' } as Outcome<A>
        return request.read(message)
      })

  /** One classifier request: the task's questions over its state, the answers read back as the output. */
  const classifyAttempt =
    <I, S extends TSchema>(task: StructuredTask<I, S>, input: I, model: ReturnType<typeof resolveClassifier>['model'], apiKey: string): Call<Static<S>>['attempt'] =>
    (_previous, cost) =>
      Effect.gen(function* () {
        const mapping = task.classify!
        const result = yield* Effect.result(Effect.tryPromise((signal) => models.classify(model, mapping.ask(input), { apiKey, signal, maxRetries: 0 })))
        if (result._tag === 'Failure') return { kind: 'provider-error', detail: String(result.failure.cause) } as Outcome<Static<S>>
        const answer = result.success
        cost.usd += answer.usage?.cost.total ?? 0
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
        return yield* run<Static<S>>({ modelId: model.id, priced, timeoutMillis: task.timeoutMillis, started, attempt: classifyAttempt(task, input, model, config.apiKey) })
      }
      const { model, priced } = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(model.id, started)
      const tool: Tool = { name: task.tool.name, description: task.tool.description, parameters: task.output }
      const request: Request<Static<S>> = {
        model,
        tool,
        toolChoice: task.tier === 'decision' ? 'forced' : 'auto',
        maxTokens: task.tier === 'decision' ? DECISION_MAX_TOKENS : GENERATION_MAX_TOKENS,
        context: { systemPrompt: task.prompt, messages: [userMessage(task.render(input))], tools: [tool] },
        read: (message) => {
          const call = message.content.find((c) => c.type === 'toolCall' && c.name === tool.name)
          if (!call || call.type !== 'toolCall') return { kind: 'invalid-output', detail: 'the model did not call the tool' }
          const checked = validateOutput(task, input, call.arguments)
          return checked.ok ? { kind: 'ok', value: checked.value } : { kind: 'invalid-output', detail: checked.message }
        },
      }
      return yield* run<Static<S>>({ modelId: model.id, priced, timeoutMillis: task.timeoutMillis, started, attempt: chatAttempt(request, config.apiKey) })
    })

  const generate: AiProviderShape['generate'] = <I>(task: TextTask<I>, input: I) =>
    Effect.gen(function* () {
      const started = Date.now()
      const config = yield* readConfig
      const { model, priced } = resolveModel(models, modelFor(task.tier, config))
      if (!config.apiKey) return noKey(model.id, started)
      const request: Request<string> = {
        model,
        toolChoice: 'auto',
        maxTokens: GENERATION_MAX_TOKENS,
        context: { systemPrompt: task.prompt, messages: [userMessage(task.render(input))] },
        read: (message) => {
          const text = cleanText(task, textOf(message))
          return text === undefined ? { kind: 'invalid-output', detail: 'empty answer' } : { kind: 'ok', value: text }
        },
      }
      return yield* run<string>({ modelId: model.id, priced, timeoutMillis: task.timeoutMillis, started, attempt: chatAttempt(request, config.apiKey) })
    })

  const chat: AiProviderShape['chat'] = (context, tools) =>
    Stream.callback<ChatEvent>((queue) =>
      Effect.gen(function* () {
        const started = Date.now()
        const config = yield* readConfig
        const { model, priced } = resolveModel(models, modelFor(chatTask.tier, config))
        const meta = (extra: Partial<AiCallMeta> = {}): AiCallMeta => ({ model: model.id, latencyMillis: Date.now() - started, attempts: 1, ...extra })
        if (!config.apiKey) {
          Queue.offerUnsafe(queue, { type: 'failed', reason: 'missing-key', meta: meta({ attempts: 0 }) })
          Queue.endUnsafe(queue)
          return
        }
        const apiKey = config.apiKey
        const piTools = tools.map(toPiTool)
        const piContext: PiContext = {
          systemPrompt: `${chatTask.prompt}\n\n${chatTask.render(context)}`,
          messages: context.messages.map((m) => toPiMessage(m, model)),
          tools: piTools,
        }
        const consume = Effect.tryPromise(async (signal) => {
          const events = models.stream(model, piContext, { apiKey, signal, maxTokens: GENERATION_MAX_TOKENS })
          let text = ''
          const calls: ChatToolCall[] = []
          for await (const event of events) {
            if (event.type === 'text_delta') {
              text += event.delta
              Queue.offerUnsafe(queue, { type: 'text', delta: event.delta })
            } else if (event.type === 'toolcall_end') {
              const call: ChatToolCall = { id: event.toolCall.id, name: event.toolCall.name, arguments: event.toolCall.arguments }
              try {
                validateToolCall(piTools, event.toolCall)
              } catch (error) {
                Queue.offerUnsafe(queue, { type: 'failed', reason: 'invalid-output', detail: error instanceof Error ? error.message : String(error), meta: meta() })
                return
              }
              calls.push(call)
              Queue.offerUnsafe(queue, { type: 'toolCall', call })
            } else if (event.type === 'error') {
              const reason: NoDecisionReason = event.reason === 'aborted' ? 'timeout' : 'provider-error'
              Queue.offerUnsafe(queue, { type: 'failed', reason, detail: event.error.errorMessage, meta: meta() })
              return
            } else if (event.type === 'done') {
              const cost = event.message.usage.cost.total
              Queue.offerUnsafe(queue, { type: 'done', text, toolCalls: calls, meta: meta(priced ? { costUsd: cost } : {}) })
            }
          }
        })
        const timed = Effect.gen(function* () {
          const result = yield* Effect.result(Effect.timeoutOption(consume, chatTask.timeoutMillis))
          if (result._tag === 'Failure') {
            Queue.offerUnsafe(queue, { type: 'failed', reason: 'provider-error', detail: String(result.failure.cause), meta: meta() })
          } else if (Option.isNone(result.success)) {
            Queue.offerUnsafe(queue, { type: 'failed', reason: 'timeout', meta: meta() })
          }
          Queue.endUnsafe(queue)
        })
        yield* Effect.forkScoped(timed)
      }),
    )

  return { decide, generate, chat }
}

/** Two attempts at most, inside the task's timeout. */
function run<A>(call: Call<A>): Effect.Effect<Decision<A>> {
  return Effect.gen(function* () {
    const cost = { usd: 0 }
    let attempts = 0
    const once = (previous: Outcome<A> | undefined) =>
      Effect.suspend(() => {
        attempts++
        return call.attempt(previous, cost)
      })
    const twice = Effect.gen(function* () {
      const first = yield* once(undefined)
      if (first.kind === 'ok' || first.kind === 'timeout') return first
      return yield* once(first)
    })
    const outcome = yield* Effect.timeoutOption(twice, call.timeoutMillis)
    const meta: AiCallMeta = {
      model: call.modelId,
      latencyMillis: Date.now() - call.started,
      attempts,
      ...(call.priced ? { costUsd: cost.usd } : {}),
    }
    if (Option.isNone(outcome)) return { _tag: 'NoDecision', reason: 'timeout', meta }
    const value = outcome.value
    if (value.kind === 'ok') return { _tag: 'Decided', value: value.value, meta }
    return { _tag: 'NoDecision', reason: value.kind, detail: value.detail, meta }
  })
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

function toPiTool(tool: ChatTool): Tool {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}

function toPiMessage(message: ChatContext['messages'][number], model: Model<Api>): PiMessage {
  const timestamp = Date.now()
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text, timestamp }
    case 'assistant':
      return {
        role: 'assistant',
        content: [
          ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
          ...message.toolCalls.map((call) => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.arguments as never })),
        ],
        api: model.api,
        provider: OPENROUTER,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: message.toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp,
      }
    case 'tool':
      return {
        role: 'toolResult',
        toolCallId: message.callId,
        toolName: message.name,
        content: [{ type: 'text', text: message.result }],
        isError: message.isError ?? false,
        timestamp,
      }
  }
}
