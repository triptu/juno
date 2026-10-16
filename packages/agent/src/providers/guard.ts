import { createCodexHarness } from './codex/harness'
import { resolveCodexModels } from './catalog'
import { createHash } from 'node:crypto'
import { Context as EffectContext, Effect, Layer } from 'effect'
import { limits, upper } from '@juno/agent-memory'
import type { Ending } from '@juno/agent-contract'
import {
  createAssistantMessageEventStream, createModels, createProvider, normalizeContext,
  type Api, type AssistantMessage, type Context, type Model, type Models, type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import { createSpend, dollars, type SpendLedger, type SpendPath } from '../spend'
import type { Store } from '../store/store'

/** What a request was built against. An admitted `Request` is one. */
export type Revision = { readonly gen: number; readonly pinRev: number }
export type ProviderFailure = { readonly ending: Ending; readonly rateLimited: boolean }
/** What a stamped request has streamed so far: its text and how many tool calls it has started. */
export type StreamProgress = { readonly text: string; readonly toolCalls: number; readonly status?: string }
type Observer = (progress: StreamProgress) => void
const progressOf = (message: AssistantMessage): StreamProgress => ({
  text: message.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join(''),
  toolCalls: message.content.filter(part => part.type === 'toolCall').length,
})
export class AdmissionError extends Error {
  readonly ending: Ending
  constructor(ending: Ending) {
    super(code(ending))
    this.ending = ending
  }
}
type Reason = Exclude<Ending, { _tag: 'complete' }>
/** The guard's failures travel through pi as `errorMessage`. Only this fixed code is kept, never a provider's error body. */
const code = (ending: Ending, rateLimited = false) => `JUNO:${ending._tag}${'reason' in ending ? `:${ending.reason}` : ''}${rateLimited ? ':429' : ''}`
const CODE = /^JUNO:(interrupted|blocked:(?:tooLarge|budget)|failed:(?:provider|missingKey|rateLimited|keyRejected|codexSignedOut|codexMissing|codexQuota|codexCrash|offline))(:429)?$/
function decode(match: string): Reason {
  const [tag, reason] = match.split(':')
  if (tag === 'interrupted') return { _tag: 'interrupted' }
  if (tag === 'blocked') return { _tag: 'blocked', reason: reason === 'budget' ? 'budget' : 'tooLarge' }
  return { _tag: 'failed', reason: reason === 'missingKey' || reason === 'rateLimited' || reason === 'keyRejected' || reason === 'codexSignedOut' || reason === 'codexMissing' || reason === 'codexQuota' || reason === 'codexCrash' || reason === 'offline' ? reason : 'provider' }
}
/** SDK errors start with the status ("401 …", "429: {…}"); pi's prefixed form is "Provider (503): …". */
const httpStatus = (text: string): number | undefined => {
  const found = /^([1-5]\d\d)\b/.exec(text) ?? /^[^\n(]*\(([1-5]\d\d)\):/.exec(text)
  return found ? Number(found[1]) : undefined
}
const failed = (reason: Extract<Ending, { _tag: 'failed' }>['reason'], rateLimited = false): ProviderFailure =>
  ({ ending: { _tag: 'failed', reason }, rateLimited })

/** Maps a guard, provider or Codex error, or a failed message's `errorMessage`, to the chat ending. */
export function providerFailure(error: unknown): ProviderFailure {
  if (error instanceof AdmissionError) return { ending: error.ending, rateLimited: false }
  const text = error instanceof Error ? error.message : String(error)
  const own = CODE.exec(text)
  if (own) return { ending: decode(own[1]!), rateLimited: own[2] !== undefined }
  const status = httpStatus(text)
  if (status === 429 || /rate.?limit/i.test(text)) return failed('rateLimited', true)
  if (/not logged in|signed out/i.test(text)) return failed('codexSignedOut')
  if (/no api key|missing .*key/i.test(text)) return failed('missingKey')
  if (status === 401 || status === 403 || /api key auth (?:check )?failed/i.test(text)) return failed('keyRejected')
  if (status !== undefined) return failed('provider')
  if (/terminated|fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|offline|socket|timed? ?out/i.test(text)) return failed('offline')
  return failed('provider')
}
/** The provider refused the request before doing any work, so it billed nothing. */
const refused = (failure: ProviderFailure) => failure.rateLimited ||
  (failure.ending._tag === 'failed' && (failure.ending.reason === 'keyRejected' || failure.ending.reason === 'missingKey'))
export function readRevision(store: Store): Revision {
  const row = store.db.prepare('SELECT gen, pin_rev FROM memory_head WHERE singleton = 1').get()!
  return { gen: Number(row.gen), pinRev: Number(row.pin_rev) }
}
// Spec `dispatchWith`: a redaction (gen) or a pin change makes a built request stale. A newer view (rev) does not.
const sameRevision = (a: Revision, b: Revision) => a.gen === b.gen && a.pinRev === b.pinRev
const hash = (model: Model<Api>, context: Context) => createHash('sha256').update(JSON.stringify([model.provider, model.id, normalizeContext(context).messages])).digest('hex')
const rendered = (context: Context) => normalizeContext(context).messages.map(message => JSON.stringify(message))

/** Cache writes and high-context tiers can cost more than ordinary input. */
function reservationCost(model: Model<Api>, input: number): number {
  const rates = [model.cost, ...(model.cost.tiers ?? [])]
  const inputRate = Math.max(...rates.flatMap(rate => [rate.input, rate.cacheRead, rate.cacheWrite]))
  const outputRate = Math.max(...rates.map(rate => rate.output))
  return dollars((input * inputRate + limits.reserve * outputRate) / 1_000_000)
}
function failedMessage(model: Model<Api>, failure: ProviderFailure, partial?: AssistantMessage): AssistantMessage {
  return {
    role: 'assistant', content: partial?.content ?? [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error', timestamp: Date.now(),
    errorMessage: code(failure.ending, failure.rateLimited),
  }
}
/**
 * One model request as the AI activity log records it (`HostAiCall` in the
 * engine's log). Never text: only the request's shape, outcome and cost.
 */
export interface GuardCall {
  readonly path: SpendPath
  readonly sessionId: string | undefined
  readonly provider: string
  readonly model: string
  readonly at: number
  readonly durationMs: number
  readonly outcome: 'ok' | 'error' | 'blocked' | 'cancelled' | 'timeout'
  /** Why it was not ok, as a short code. '' when ok. */
  readonly kind: string
  /** The HTTP status of a provider error, when there was one. Never the error's body. */
  readonly message: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly costUsd: number | null
  readonly outputChars: number
  readonly toolCalls: number
}

/** The log's outcome for a failed request. */
function failureOutcome(failure: ProviderFailure): Pick<GuardCall, 'outcome' | 'kind'> {
  const ending = failure.ending
  if (ending._tag === 'interrupted') return { outcome: 'cancelled', kind: 'interrupted' }
  if (ending._tag === 'blocked') return { outcome: 'blocked', kind: ending.reason === 'budget' ? 'cap' : 'too-large' }
  if (ending._tag === 'failed' && ending.reason === 'missingKey') return { outcome: 'blocked', kind: 'no-key' }
  if (ending._tag === 'failed') return { outcome: 'error', kind: ending.reason }
  return { outcome: 'error', kind: ending._tag }
}

type CallBase = Pick<GuardCall, 'path' | 'sessionId' | 'provider' | 'model' | 'at'>

/** A request that finished: its usage when the provider reported any, and the shape of its answer. */
function doneCall(base: CallBase, message: AssistantMessage): GuardCall {
  const usage = message.usage
  const reported = usage.totalTokens > 0
  const cost = usage.cost.total
  const shape = progressOf(message)
  return {
    ...base, durationMs: Date.now() - base.at, outcome: 'ok', kind: '', message: '',
    inputTokens: reported ? usage.input + usage.cacheRead + usage.cacheWrite : null, outputTokens: reported ? usage.output : null,
    costUsd: reported && Number.isFinite(cost) && cost >= 0 ? cost : null,
    outputChars: shape.text.length, toolCalls: shape.toolCalls,
  }
}

/** A request that did not finish. Of a provider's error only the HTTP status is kept. */
function failedCall(base: CallBase, failure: ProviderFailure, error: unknown): GuardCall {
  const status = error === undefined || error instanceof AdmissionError ? undefined : httpStatus(error instanceof Error ? error.message : String(error))
  return {
    ...base, durationMs: Date.now() - base.at, ...failureOutcome(failure), message: status === undefined ? '' : `HTTP ${status}`,
    inputTokens: null, outputTokens: null, costUsd: null, outputChars: 0, toolCalls: 0,
  }
}

/** Ends `outer` with a whole answer (Codex's), and gives its record. */
function answerWhole(outer: ReturnType<typeof createAssistantMessageEventStream>, base: CallBase, message: AssistantMessage): GuardCall {
  if (message.stopReason === 'error') outer.push({ type: 'error', reason: 'error', error: message })
  else outer.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message })
  outer.end(message)
  return message.stopReason === 'error' ? failedCall(base, providerFailure(message.errorMessage ?? 'failed'), undefined) : doneCall(base, message)
}

export interface GuardOptions {
  readonly store: Store
  readonly transport: Models
  readonly spend?: SpendLedger
  readonly codex?: { readonly agentDir: string; readonly executable: string }
  readonly onFailure?: (failure: ProviderFailure) => void
}

/** The transport is private. Give only these models to pi-durable. */
export function createProviderGuard(options: GuardOptions) {
  const { store, transport } = options
  const spend = options.spend ?? createSpend(store)
  const stamps = new Map<string, Array<{ revision: Revision; path: SpendPath; observe?: Observer }>>()
  const multiplier = (provider: string): 1 | 1.25 => store.db.prepare('SELECT 1 FROM provider_bounds WHERE provider = ?').get(provider) ? 1.25 : 1
  const check = (model: Model<Api>, context: Context, revision: Revision): number => {
    if (!sameRevision(revision, readRevision(store))) throw new AdmissionError({ _tag: 'interrupted' })
    // The byte bound applies to text. Images need a separate measured bound.
    if (normalizeContext(context).messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image'))) {
      throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
    }
    const input = upper(rendered(context), multiplier(model.provider))
    if (input + limits.reserve > model.contextWindow) throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
    return input
  }
  const models = createModels()
  const listeners = new Set<(call: GuardCall) => void>()
  const tell = (call: GuardCall) => {
    for (const listener of listeners) {
      try {
        listener(call)
      } catch {
        // A listener's failure never reaches the request.
      }
    }
  }
  const stream = (requested: Model<Api>, context: Context, streamOptions?: SimpleStreamOptions) => {
    const outer = createAssistantMessageEventStream()
    // Copy synchronously: callers cannot mutate the admitted request while auth awaits.
    const copy = structuredClone(context)
    const key = hash(requested, copy)
    const pending = stamps.get(key)
    const stamp = pending?.shift()
    if (!pending?.length) stamps.delete(key)
    const base: CallBase = { path: stamp?.path ?? 'chat', sessionId: streamOptions?.sessionId, provider: requested.provider, model: requested.id, at: Date.now() }
    void (async (): Promise<GuardCall> => {
      let reservation: string | undefined
      let partial: AssistantMessage | undefined
      let started = false
      let bound = 0
      let localFailure: AdmissionError | undefined
      let wirePassed = false
      let definitelyNotSent = false
      try {
        const model = requested.provider === 'openai-codex' && harness ? requested : transport.getModel(requested.provider, requested.id)
        if (!model || !stamp) throw new AdmissionError({ _tag: 'interrupted' })
        bound = check(model, copy, stamp.revision)
        if (model.provider === 'openai-codex' && harness) return answerWhole(outer, base, harness.response(model, copy, stamp.revision, stamp.observe))
        const held = spend.reserve(stamp.path, reservationCost(model, bound))
        if (held.kind === 'blocked') throw new AdmissionError({ _tag: 'blocked', reason: 'budget' })
        reservation = held.id
        const wireCheck = (payload: unknown): undefined => {
          try {
            if (wirePassed) throw new AdmissionError({ _tag: 'interrupted' })
            check(model, copy, stamp.revision)
            // Count the adapter's final JSON as well, including its extra fields.
            const serialized = JSON.stringify(payload)
            if (serialized === undefined) throw new AdmissionError({ _tag: 'interrupted' })
            bound = Math.max(bound, upper([serialized, ...copy.messages.map(() => '')], multiplier(model.provider)))
            if (bound + limits.reserve > model.contextWindow) throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
            if (!spend.extend(held.id, reservationCost(model, bound))) throw new AdmissionError({ _tag: 'blocked', reason: 'budget' })
            wirePassed = true
            return undefined
          } catch (error) {
            definitelyNotSent = !wirePassed
            if (error instanceof AdmissionError) localFailure = error
            throw error
          }
        }
        // Never forward arbitrary sampling parameters, hooks, auth or output overrides.
        const inner = transport.streamSimple({ ...model, maxTokens: Math.min(model.maxTokens, limits.reserve), samplingParams: undefined, samplingParamsByThinkingLevel: undefined }, copy, {
          maxTokens: Math.min(model.maxTokens, limits.reserve), maxRetries: 0,
          cacheRetention: 'short', sessionId: streamOptions?.sessionId,
          signal: streamOptions?.signal, onPayload: wireCheck,
        })
        for await (const event of inner) {
          if (event.type === 'error') {
            partial = event.error
            throw localFailure ?? new Error(event.error.errorMessage ?? 'Provider failed')
          }
          if (event.type === 'done') {
            const usage = event.message.usage
            const observed = usage.input + usage.cacheRead + usage.cacheWrite
            if (observed > bound) store.db.prepare('INSERT OR IGNORE INTO provider_bounds(provider, multiplier) VALUES (?, 1.25)').run(model.provider)
            const cost = usage.cost.total
            // A zero report from an interrupted or missing-usage stream is not a receipt.
            spend.settle(held.id, usage.totalTokens > 0 && Number.isFinite(cost) && cost >= 0 ? dollars(cost) : undefined)
            stamp.observe?.(progressOf(event.message))
            outer.push(event)
            outer.end(event.message)
            return doneCall(base, event.message)
          }
          partial = event.partial
          started = true
          stamp.observe?.(progressOf(event.partial))
          outer.push(event)
        }
        throw new Error('terminated')
      } catch (error) {
        const failure = providerFailure(error)
        // Anything else may have been billed: keep the whole reservation.
        const unbilled = (localFailure && definitelyNotSent) || (!started && refused(failure))
        if (reservation) spend.settle(reservation, unbilled ? 0 : undefined)
        const message = failedMessage(requested, failure, partial)
        outer.push({ type: 'error', reason: 'error', error: message })
        outer.end(message)
        options.onFailure?.(failure)
        return failedCall(base, failure, error)
      }
    })().then(tell)
    return outer
  }
  const admitHarness = (revision: Revision, model: Model<Api>, prompt: string): string => {
    check(model, { messages: [{ role: 'user', content: prompt, timestamp: 0 }] }, revision)
    return prompt
  }
  const harness = options.codex ? createCodexHarness({ ...options.codex, store, guard: { spend, admitHarness } }) : undefined
  const register = () => {
    const codex = harness ? resolveCodexModels(undefined, { systemAndTools: [] }) : undefined
    if (codex) models.setProvider(createProvider({ id: 'openai-codex', models: [codex.model],
      auth: { apiKey: { name: 'Codex', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }))
    for (const provider of transport.getProviders()) models.setProvider(createProvider({
      id: provider.id,
      auth: { apiKey: { name: provider.name, resolve: async () => ({ auth: {} }) } },
      models: [...provider.getModels()],
      api: { stream, streamSimple: stream },
    }))
  }
  register()
  const publicModels: Models = models
  return {
    models: publicModels,
    harnessTool: harness?.tool,
    /** Takes the transport's model list again, after the picker's catalogue changed. */
    refreshModels: register,
    spend,
    /** Hears every request the guard ends, for the AI activity log. Returns the way to stop hearing. */
    onCall: (listener: (call: GuardCall) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * Called only by the trusted builder hook, after persisting any emergency
     * merge. Pass the admitted `Request` (it is a `Revision`) and the context
     * built from it. One use. `observe` sees the request's text as it streams.
     */
    stamp: (revision: Revision, model: Model<Api>, context: Context, path: SpendPath = 'chat', observe?: Observer): Context => {
      const copy = structuredClone(context)
      check(model, copy, revision)
      const key = hash(model, copy)
      const pending = stamps.get(key) ?? []
      pending.push({ revision: { gen: revision.gen, pinRev: revision.pinRev }, path, ...(observe ? { observe } : {}) })
      stamps.set(key, pending)
      return copy
    },
    /** The Codex harness gets the same memory admission. Its turns are counted, not charged. */
    admitHarness,
  }
}
export type ProviderGuardApi = ReturnType<typeof createProviderGuard>
export class ProviderGuard extends EffectContext.Service<ProviderGuard, ProviderGuardApi>()('juno/agent/ProviderGuard') {
  static layer(options: GuardOptions): Layer.Layer<ProviderGuard> {
    return Layer.effect(ProviderGuard, Effect.sync(() => createProviderGuard(options)))
  }
}
