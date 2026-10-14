/**
 * A scripted model provider on pi-ai's faux core, registered under the
 * provider id `openrouter` with the slugs the model picker resolves today
 * (docs/juno-agent/spikes.md), so runtime code addresses fake models exactly
 * as it addresses real ones.
 *
 * Each chat request takes the next scripted step: a reply, a stream that is
 * lost part way, or an HTTP error. Requests to a compaction model are answered
 * by the deterministic compactor instead (./compactor.ts).
 */
import {
  calculateCost,
  createAssistantMessageEventStream,
  createFauxCore,
  createModels,
  createProvider,
  fauxAssistantMessage,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type FauxContentBlock,
  type FauxModelDefinition,
  type FauxResponseFactory,
  type Model,
  type Models,
  type SimpleStreamOptions,
  type TranscriptContext,
  type Usage,
} from '@earendil-works/pi-ai'
import { compactorAnswer, type CompactorOptions } from './compactor'

export const FAKE_PROVIDER = 'openrouter'

const price = (input: number, output: number) => ({ input, output, cacheRead: input / 10, cacheWrite: input * 1.25 })

/**
 * The chat families and both compaction models, with their real context
 * windows and input and output prices per million tokens (spikes.md). The
 * cache prices are invented: a tenth and 1.25 times the input price.
 */
export const fakeCatalogue: ReadonlyArray<FauxModelDefinition> = [
  { id: 'anthropic/claude-sonnet-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(2, 10) },
  { id: 'anthropic/claude-opus-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(4, 20) },
  { id: 'meta/muse-wonder', contextWindow: 1_048_576, maxTokens: 64_000, cost: price(4, 20) },
  { id: 'openai/gpt-6.1-sol', contextWindow: 1_050_000, maxTokens: 64_000, cost: price(2, 10) },
  { id: 'x-ai/grok-4.7', contextWindow: 500_000, maxTokens: 64_000, cost: price(2, 6) },
  { id: 'anthropic/claude-haiku-5.5', contextWindow: 1_000_000, maxTokens: 64_000, cost: price(0.1, 0.5) },
  { id: 'google/gemini-3.8-flash', contextWindow: 1_048_576, maxTokens: 64_000, cost: price(0.75, 3.75) },
]

/** The compaction default and its alternative (plan v3 §7.1). */
export const COMPACTION_MODELS: ReadonlyArray<string> = ['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash']

/** What the provider reports as used. Cost is computed from the model's prices. */
export interface UsageReport {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export type ModelStep =
  | { readonly kind: 'reply'; readonly answer: AssistantMessage | FauxResponseFactory; readonly usage?: UsageReport }
  | { readonly kind: 'lost'; readonly answer: AssistantMessage; readonly afterChars: number }
  | { readonly kind: 'http'; readonly status: number; readonly body: unknown }

type Content = string | FauxContentBlock | FauxContentBlock[]

/**
 * A complete answer. Without `usage`, pi-ai's faux estimate is reported
 * (prompt characters / 4, with cache reads when `sessionId` is set).
 */
export function reply(content: Content | FauxResponseFactory, options: { readonly usage?: UsageReport; readonly stopReason?: AssistantMessage['stopReason'] } = {}): ModelStep {
  const answer = typeof content === 'function' ? content : fauxAssistantMessage(content, { stopReason: options.stopReason ?? stopReasonFor(content) })
  return options.usage ? { kind: 'reply', answer, usage: options.usage } : { kind: 'reply', answer }
}

/**
 * The response starts (HTTP 200, `start`, deltas) and the connection drops
 * after about `afterChars` characters of text. The stream ends with an `error`
 * event whose message is `terminated`, as undici reports a dropped body, and
 * no usage: the provider never reported it, so the spend is unknown.
 */
export function lostStream(content: Content, options: { readonly afterChars?: number } = {}): ModelStep {
  return { kind: 'lost', answer: fauxAssistantMessage(content, { stopReason: stopReasonFor(content) }), afterChars: options.afterChars ?? 0 }
}

/**
 * The provider answers with an HTTP error before streaming. pi-ai then emits a
 * single `error` event with no `start`, no usage, and `errorMessage` of the
 * form `<status>: <body JSON>`, as its OpenAI-compatible path formats SDK errors.
 */
export function httpError(status: number, message: string): ModelStep {
  return { kind: 'http', status, body: { error: { message, code: status } } }
}

/** OpenRouter's upstream failures: 500, 502 or 503. */
export const serverError = (status: 500 | 502 | 503 = 503) =>
  httpError(status, status === 503 ? 'Service unavailable' : status === 502 ? 'Bad gateway' : 'Internal server error')
/** A key OpenRouter does not recognise. */
export const rejectedKey = () => httpError(401, 'User not found.')
/** OpenRouter's rate limit. */
export const rateLimited = () => httpError(429, 'Rate limit exceeded')

export interface FakeRequest {
  readonly model: string
  readonly context: TranscriptContext
  readonly options: SimpleStreamOptions | undefined
}

export interface FakeProviderOptions {
  readonly catalogue?: ReadonlyArray<FauxModelDefinition>
  /** Models answered by the compactor, never by the script. Default `COMPACTION_MODELS`. */
  readonly compactionModels?: ReadonlyArray<string>
  readonly compactor?: CompactorOptions
}

export interface FakeProvider {
  readonly models: Models
  /** The model as pi-ai resolves it, by slug. Throws for a slug not in the catalogue. */
  readonly model: (id: string) => Model<string>
  /** Replaces the chat script. */
  readonly script: (steps: ReadonlyArray<ModelStep>) => void
  /** Every request so far, chat and compaction, in order. */
  readonly requests: ReadonlyArray<FakeRequest>
  /** Chat steps not yet used. A chat request with none left fails with "No more faux responses queued". */
  readonly pending: () => number
}

const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

export function fakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const catalogue = options.catalogue ?? fakeCatalogue
  const compaction = new Set(options.compactionModels ?? COMPACTION_MODELS)
  const core = createFauxCore({ provider: FAKE_PROVIDER, models: [...catalogue] })
  let steps: ModelStep[] = []
  const requests: FakeRequest[] = []
  let compactions = 0

  const stream = (model: Model<string>, context: TranscriptContext, streamOptions?: SimpleStreamOptions): AssistantMessageEventStream => {
    requests.push({ model: model.id, context, options: streamOptions })
    const step: ModelStep | undefined = compaction.has(model.id)
      ? reply(compactorAnswer(context, compactions++, options.compactor))
      : steps.shift()
    if (!step) {
      core.setResponses([])
      return core.stream(model, context, streamOptions)
    }
    if (step.kind === 'http') return httpFailure(model, step)
    core.setResponses([step.answer])
    const inner = core.stream(model, context, streamOptions)
    return step.kind === 'lost' ? cut(inner, step.afterChars) : priced(inner, model, step.usage)
  }

  const provider = createProvider({
    id: FAKE_PROVIDER,
    auth: { apiKey: { name: 'OpenRouter (fake)', resolve: async () => ({ auth: {} }) } },
    models: core.models,
    api: { stream, streamSimple: stream },
  })
  const models = createModels()
  models.setProvider(provider)
  return {
    models,
    model: (id) => {
      const found = core.getModel(id)
      if (!found) throw new Error(`fake catalogue has no model ${id}`)
      return found
    },
    script: (next) => {
      steps = [...next]
    },
    requests,
    pending: () => steps.length,
  }
}

function stopReasonFor(content: Content): AssistantMessage['stopReason'] {
  const blocks = typeof content === 'string' ? [] : Array.isArray(content) ? content : [content]
  return blocks.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop'
}

/** Forwards a faux stream, replacing the final usage with the report (if any) and its cost. */
function priced(inner: AssistantMessageEventStream, model: Model<string>, report: UsageReport | undefined): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream()
  const settle = (message: AssistantMessage): AssistantMessage => {
    const counts = report ? { input: report.input, output: report.output, cacheRead: report.cacheRead ?? 0, cacheWrite: report.cacheWrite ?? 0 } : message.usage
    const usage: Usage = { ...counts, totalTokens: counts.input + counts.output + counts.cacheRead + counts.cacheWrite, cost: ZERO_USAGE.cost }
    return { ...message, usage: { ...usage, cost: calculateCost(model, usage) } }
  }
  void (async () => {
    for await (const event of inner) {
      if (event.type === 'done') {
        const message = settle(event.message)
        outer.push({ ...event, message })
        outer.end(message)
        return
      }
      if (event.type === 'error') {
        outer.push(event)
        outer.end(event.error)
        return
      }
      outer.push(event)
    }
  })()
  return outer
}

/** Forwards a faux stream until about `afterChars` characters have streamed, then drops it. */
function cut(inner: AssistantMessageEventStream, afterChars: number): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream()
  void (async () => {
    let streamed = 0
    let partial: AssistantMessage | undefined
    for await (const event of inner) {
      if (event.type === 'done' || event.type === 'error') break
      outer.push(event)
      partial = structuredClone(event.partial)
      if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'toolcall_delta') streamed += event.delta.length
      if (event.type !== 'start' && streamed >= afterChars) break
    }
    const error: AssistantMessage = { ...(partial ?? fauxAssistantMessage([])), stopReason: 'error', errorMessage: 'terminated', usage: ZERO_USAGE }
    const last: AssistantMessageEvent = { type: 'error', reason: 'error', error }
    outer.push(last)
    outer.end(error)
  })()
  return outer
}

function httpFailure(model: Model<string>, step: Extract<ModelStep, { kind: 'http' }>): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream()
  queueMicrotask(() => {
    const error: AssistantMessage = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: ZERO_USAGE, stopReason: 'error', errorMessage: `${step.status}: ${JSON.stringify(step.body)}`, timestamp: Date.now(),
    }
    outer.push({ type: 'error', reason: 'error', error })
    outer.end(error)
  })
  return outer
}
