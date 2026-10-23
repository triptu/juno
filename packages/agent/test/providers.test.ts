import { afterEach, beforeEach, expect, it } from 'bun:test'
import { httpError, lostStream, rateLimited, rejectedKey, reply, serverError } from '@juno/agent-testing'
import { AdmissionError, createCompactionProvider, createProviderGuard, dollars, providerFailure } from '../src/index'
import type { GuardCall } from '../src/providers/guard'
import { providerHarness, request } from './providers-harness'

let h: Awaited<ReturnType<typeof providerHarness>>
beforeEach(async () => { h = await providerHarness() })
afterEach(async () => { await h.close() })

const ending = (message: { readonly errorMessage?: string }) => providerFailure(message.errorMessage).ending
const refusal = (admit: () => unknown) => {
  try { admit() } catch (error) { if (error instanceof AdmissionError) return error.ending }
  return undefined
}

it('never sends an unstamped, changed, oversized or unaffordable request', async () => {
  const guard = h.guard()
  const raw = { messages: [{ role: 'user' as const, content: 'raw fallback', timestamp: 0 }] }
  expect(ending(await guard.models.completeSimple(h.model, raw))).toEqual({ _tag: 'interrupted' })

  const { revision, context } = request()
  const changed = guard.stamp(revision, h.model, context)
  changed.messages.push({ role: 'user', content: 'not stamped', timestamp: 0 })
  expect(ending(await guard.models.completeSimple(h.model, changed))).toEqual({ _tag: 'interrupted' })

  const small = { ...h.model, contextWindow: 16_384 }
  expect(refusal(() => guard.stamp(revision, small, context))).toEqual({ _tag: 'blocked', reason: 'tooLarge' })

  guard.spend.reserve('subagent', dollars(2))
  const blocked = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, context))
  expect(ending(blocked)).toEqual({ _tag: 'blocked', reason: 'budget' })
  expect(h.fake.requests).toHaveLength(0)
})

it.each([
  ['a server error', serverError(), 'provider', false, 'kept'],
  ['a rejected key', rejectedKey(), 'keyRejected', false, 'released'],
  ['a rate limit', rateLimited(), 'rateLimited', true, 'released'],
  ['a lost stream', lostStream('an unfinished answer', { afterChars: 4 }), 'offline', false, 'kept'],
  ['a failed connection', httpError(0, 'fetch failed'), 'offline', false, 'kept'],
] as const)('maps %s to its reason, sends once and keeps any spend it cannot rule out', async (_, step, reason, rateLimit, spend) => {
  h.fake.script([step])
  const guard = h.guard()
  const { revision, context } = request()
  const result = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, context))
  expect(providerFailure(result.errorMessage)).toEqual({ ending: { _tag: 'failed', reason }, rateLimited: rateLimit })
  if (step.kind === 'lost') expect(result.content).not.toHaveLength(0)
  expect(h.fake.requests).toHaveLength(1)
  expect(h.fake.requests[0]!.options).toMatchObject({ maxRetries: 0, maxTokens: 16_384 })
  const snapshot = guard.spend.snapshot()
  expect(snapshot.actual).toBe(0)
  if (spend === 'kept') expect(snapshot.unknown).toBeGreaterThan(0)
  expect(snapshot.reserved).toBe(snapshot.unknown)
})

it('settles reported usage, keeps cache affinity and uses each stamp once', async () => {
  h.fake.script([reply('hello', { usage: { input: 100, output: 10, cacheRead: 10, cacheWrite: 20 } })])
  const guard = h.guard()
  const { revision, context } = request()
  const stamped = guard.stamp(revision, h.model, context)
  const result = await guard.models.completeSimple(h.model, stamped, { sessionId: 'stable-session', maxTokens: 100_000, maxRetries: 8 })
  expect(result.stopReason).toBe('stop')
  expect(h.fake.requests[0]!.options).toMatchObject({ sessionId: 'stable-session', cacheRetention: 'short', maxRetries: 0, maxTokens: 16_384 })
  expect(guard.spend.snapshot()).toMatchObject({ reserved: 0, unknown: 0, actual: dollars(result.usage.cost.total) })
  expect(ending(await guard.models.completeSimple(h.model, stamped))).toEqual({ _tag: 'interrupted' })
  expect(h.fake.requests).toHaveLength(1)
})

it('runs compaction through the same guard and stops it at its share of the cap', async () => {
  const guard = h.guard()
  const compactor = createCompactionProvider({ store: h.core.store, guard, model: h.fake.model('anthropic/claude-haiku-5.5'),
    system: 'You are Juno.', tools: [], sessionId: 'stable-compaction' })
  expect(await compactor.summarize(['Compaction: compress messages 0–0 into one line.', '<input>\nInvented text\n</input>'])).toContain('Invented text')
  expect(guard.spend.snapshot().compaction).toBeGreaterThan(0)
  guard.spend.reserve('compaction', dollars(0.5) - guard.spend.snapshot().compaction)
  await expect(compactor.summarize(['Compaction: compress messages 1–1 into one line.', '<input>\nInvented text\n</input>'])).rejects.toThrow('budget')
  expect(guard.spend.reserve('chat', dollars(1.5)).kind).toBe('reserved')
  expect(h.fake.requests).toHaveLength(1)
})

it('distinguishes a missing key from a rejected key and a rate limit', () => {
  expect(providerFailure(new Error('No API key'))).toEqual({ ending: { _tag: 'failed', reason: 'missingKey' }, rateLimited: false })
  expect(providerFailure('JUNO:failed:missingKey').ending).toEqual({ _tag: 'failed', reason: 'missingKey' })
  expect(providerFailure('JUNO:failed:rateLimited:429')).toEqual({ ending: { _tag: 'failed', reason: 'rateLimited' }, rateLimited: true })
})

it('asks the fallback model once when the model refuses under its policy, and logs both requests', async () => {
  h.fake.script([httpError(403, 'Input was flagged by moderation'), reply('hello')])
  const fallback = h.fake.model('google/gemini-3.8-flash')
  const guard = createProviderGuard({ store: h.core.store, transport: h.fake.models, fallback: () => fallback })
  const calls: GuardCall[] = []
  guard.onCall((call) => { calls.push(call) })
  const { revision, context } = request()
  const result = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, context))
  expect(result).toMatchObject({ stopReason: 'stop', model: 'google/gemini-3.8-flash' })
  expect(h.fake.requests.map((sent) => sent.model)).toEqual(['anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash'])
  for (let tries = 0; tries < 50 && calls.length < 2; tries++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(calls.map((call) => [call.model, call.outcome, call.kind, call.message])).toEqual([
    ['anthropic/claude-sonnet-5.5', 'error', 'policy.fallback', 'HTTP 403'],
    ['google/gemini-3.8-flash', 'ok', '', ''],
  ])
  // The refusal came before output, so only the fallback's cost stays in the ledger.
  expect(guard.spend.snapshot()).toMatchObject({ reserved: 0, unknown: 0, actual: dollars(result.usage.cost.total) })
})

it('ends a policy refusal with no fallback as refused, sends it once and does not ask a model by the same maker', async () => {
  h.fake.script([httpError(400, "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy."), reply('hello')])
  const guard = createProviderGuard({ store: h.core.store, transport: h.fake.models, fallback: () => h.fake.model('anthropic/claude-haiku-5.5') })
  const { revision, context } = request()
  const result = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, context))
  expect(ending(result)).toEqual({ _tag: 'failed', reason: 'refused' })
  expect(h.fake.requests).toHaveLength(1)
})
