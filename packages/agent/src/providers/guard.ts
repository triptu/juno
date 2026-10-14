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
export class AdmissionError extends Error {
  constructor(readonly ending: Ending) { super(code(ending)) }
}
type Reason = Exclude<Ending, { _tag: 'complete' | 'stopped' }>
/** The guard's failures travel through pi as `errorMessage`. Only this fixed code is kept, never a provider's error body. */
const code = (ending: Ending, rateLimited = false) => `JUNO:${ending._tag}${'reason' in ending ? `:${ending.reason}` : ''}${rateLimited ? ':429' : ''}`
const CODE = /^JUNO:(interrupted|blocked:(?:tooLarge|budget)|failed:(?:provider|keyRejected|codexSignedOut|offline))(:429)?$/
function decode(match: string): Reason {
  const [tag, reason] = match.split(':')
  if (tag === 'interrupted') return { _tag: 'interrupted' }
  if (tag === 'blocked') return { _tag: 'blocked', reason: reason === 'budget' ? 'budget' : 'tooLarge' }
  return { _tag: 'failed', reason: reason === 'keyRejected' || reason === 'codexSignedOut' || reason === 'offline' ? reason : 'provider' }
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
  if (status === 429 || /rate.?limit/i.test(text)) return failed('provider', true)
  if (/not logged in|signed out/i.test(text)) return failed('codexSignedOut')
  if (status === 401 || status === 403 || /no api key|missing .*key|api key auth (?:check )?failed/i.test(text)) return failed('keyRejected')
  if (status !== undefined) return failed('provider')
  if (/terminated|fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|offline|socket|timed? ?out/i.test(text)) return failed('offline')
  return failed('provider')
}
/** The provider refused the request before doing any work, so it billed nothing. */
const refused = (failure: ProviderFailure) => failure.rateLimited ||
  (failure.ending._tag === 'failed' && failure.ending.reason === 'keyRejected')
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
export interface GuardOptions {
  readonly store: Store
  readonly transport: Models
  readonly spend?: SpendLedger
  readonly onFailure?: (failure: ProviderFailure) => void
}

/** The transport is private. Give only these models to pi-durable. */
export function createProviderGuard(options: GuardOptions) {
  const { store, transport } = options
  const spend = options.spend ?? createSpend(store)
  const stamps = new Map<string, Array<{ revision: Revision; path: SpendPath }>>()
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
  const stream = (requested: Model<Api>, context: Context, streamOptions?: SimpleStreamOptions) => {
    const outer = createAssistantMessageEventStream()
    // Copy synchronously: callers cannot mutate the admitted request while auth awaits.
    const copy = structuredClone(context)
    const key = hash(requested, copy)
    const pending = stamps.get(key)
    const stamp = pending?.shift()
    if (!pending?.length) stamps.delete(key)
    void (async () => {
      let reservation: string | undefined
      let partial: AssistantMessage | undefined
      let started = false
      let bound = 0
      let localFailure: AdmissionError | undefined
      let wirePassed = false
      let definitelyNotSent = false
      try {
        const model = transport.getModel(requested.provider, requested.id)
        if (!model || !stamp) throw new AdmissionError({ _tag: 'interrupted' })
        bound = check(model, copy, stamp.revision)
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
            outer.push(event)
            outer.end(event.message)
            return
          }
          partial = event.partial
          started = true
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
      }
    })()
    return outer
  }
  for (const provider of transport.getProviders()) models.setProvider(createProvider({
    id: provider.id,
    auth: { apiKey: { name: provider.name, resolve: async () => ({ auth: {} }) } },
    models: [...provider.getModels()],
    api: { stream, streamSimple: stream },
  }))
  const publicModels: Models = models
  return {
    models: publicModels,
    spend,
    /**
     * Called only by the trusted builder hook, after persisting any emergency
     * merge. Pass the admitted `Request` (it is a `Revision`) and the context
     * built from it. One use.
     */
    stamp: (revision: Revision, model: Model<Api>, context: Context, path: SpendPath = 'chat'): Context => {
      const copy = structuredClone(context)
      check(model, copy, revision)
      const key = hash(model, copy)
      const pending = stamps.get(key) ?? []
      pending.push({ revision: { gen: revision.gen, pinRev: revision.pinRev }, path })
      stamps.set(key, pending)
      return copy
    },
    /** The Codex harness gets the same memory admission. Its turns are counted, not charged. */
    admitHarness: (revision: Revision, model: Model<Api>, prompt: string): string => {
      check(model, { messages: [{ role: 'user', content: prompt, timestamp: 0 }] }, revision)
      return prompt
    },
  }
}
export type ProviderGuardApi = ReturnType<typeof createProviderGuard>
export class ProviderGuard extends EffectContext.Service<ProviderGuard, ProviderGuardApi>()('juno/agent/ProviderGuard') {
  static layer(options: GuardOptions): Layer.Layer<ProviderGuard> {
    return Layer.effect(ProviderGuard, Effect.sync(() => createProviderGuard(options)))
  }
}
