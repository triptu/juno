import { afterEach, beforeEach, expect, it } from 'bun:test'
import { reply } from '@juno/agent-testing'
import { dollars, type SpendLedger } from '../src/index'
import { providerHarness, request } from './providers-harness'

let h: Awaited<ReturnType<typeof providerHarness>>
let ledger: SpendLedger
beforeEach(async () => { h = await providerHarness(); ledger = h.spend() })
afterEach(async () => { await h.close() })
const invariant = () => {
  const s = ledger.snapshot()
  expect(s.reserved + s.actual).toBeLessThanOrEqual(s.cap + s.raises)
  expect(s.unknown).toBeLessThanOrEqual(s.reserved)
  expect(s.compaction).toBeLessThanOrEqual(Math.floor((s.cap + s.raises) / 4))
}

it('preserves capHard across parallel reservations, settlement, unknown usage and owner raises', async () => {
  // Deterministic generated traces, with all callers released in the same microtask turn.
  for (let seed = 1; seed <= 12; seed++) {
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
        const path = (i + seed) % 3 === 0 ? 'compaction' : i % 2 === 0 ? 'subagent' : 'chat'
        const amount = dollars(((seed * 13 + round * 7 + i) % 20 + 1) / 100)
        const result = ledger.reserve(path, amount)
        invariant()
        await Promise.resolve()
        if (result.kind === 'reserved') ledger.settle(result.id, i % 4 === 0 ? undefined : Math.floor(amount / 2))
        invariant()
        return result
      }))
      expect(results).toHaveLength(12)
      if (round === 2) ledger.allowDollar(`raise-${seed}`)
      invariant()
    }
    h.nextDay()
  }
})

it('admits exactly what fits when callers race for the last of the cap (spec parallelBudget)', async () => {
  // All five callers are in flight before any of them reserves.
  const results = await Promise.all([0, 1, 2, 3, 4].map(async i => {
    await new Promise(resolve => setImmediate(resolve))
    return ledger.reserve(i === 4 ? 'compaction' : i % 2 === 0 ? 'chat' : 'subagent', dollars(0.5))
  }))
  expect(results.filter(r => r.kind === 'reserved')).toHaveLength(4)
  expect(results.at(-1)).toEqual({ kind: 'blocked', reason: 'budget' })
  expect(ledger.snapshot()).toMatchObject({ reserved: dollars(2), compaction: 0 })
})

it('keeps an unknown reservation for its whole day, across a reopen and a late report', async () => {
  const reservation = ledger.reserve('chat', dollars(2))
  expect(reservation.kind).toBe('reserved')
  if (reservation.kind !== 'reserved') return
  ledger.settle(reservation.id, undefined)
  await h.reopen()
  ledger = h.spend()
  expect(ledger.snapshot()).toMatchObject({ reserved: dollars(2), unknown: dollars(2), actual: 0 })
  ledger.settle(reservation.id, dollars(1))
  expect(ledger.snapshot()).toMatchObject({ reserved: dollars(2), unknown: dollars(2), actual: 0 })
  expect(ledger.reserve('subagent', 1).kind).toBe('blocked')
  h.nextDay()
  expect(ledger.snapshot()).toMatchObject({ reserved: 0, actual: 0 })
  expect(ledger.reserve('chat', dollars(2)).kind).toBe('reserved')
  expect(ledger.snapshot('2026-10-14')).toMatchObject({ reserved: dollars(2), unknown: dollars(2), actual: 0 })
})

it('keeps compaction inside both limits, and applies each $1 click only once for that day', () => {
  const compact = ledger.reserve('compaction', dollars(0.5))
  expect(compact.kind).toBe('reserved')
  expect(ledger.reserve('compaction', 1).kind).toBe('blocked')
  expect(ledger.reserve('chat', dollars(1.5)).kind).toBe('reserved')
  expect(ledger.reserve('compaction', 1).kind).toBe('blocked')
  ledger.allowDollar('owner-click')
  ledger.allowDollar('owner-click')
  expect(ledger.snapshot().raises).toBe(dollars(1))
  expect(ledger.reserve('compaction', dollars(0.25)).kind).toBe('reserved')
  expect(ledger.reserve('compaction', 1).kind).toBe('blocked')
  expect(ledger.reserve('subagent', dollars(0.75)).kind).toBe('reserved')
  invariant()
  expect(ledger.setCap(0)).toBe(true)
  h.nextDay()
  ledger.allowDollar('owner-click')
  expect(ledger.snapshot()).toMatchObject({ cap: dollars(2), raises: 0, reserved: 0 })
})

it('keeps the engine calls inside half of the cap, counts them for chat, and applies a repeated reservation once (spec engineBudget)', () => {
  const first = ledger.reserve('engine', dollars(0.6), 'engine-ask-1')
  expect(first).toEqual({ kind: 'reserved', id: 'engine-ask-1' })
  // The host offers an ask until the agent answers it: the repeat reserves nothing more.
  expect(ledger.reserve('engine', dollars(0.6), 'engine-ask-1')).toEqual({ kind: 'reserved', id: 'engine-ask-1' })
  expect(ledger.snapshot().reserved).toBe(dollars(0.6))
  expect(ledger.reserve('engine', dollars(0.5), 'engine-ask-2').kind).toBe('blocked')
  ledger.settle('engine-ask-1', dollars(0.1))
  expect(ledger.reserve('engine', dollars(0.5), 'engine-ask-3').kind).toBe('reserved')
  ledger.settle('engine-ask-3', undefined)
  expect(ledger.reserve('engine', dollars(0.5), 'engine-ask-4').kind).toBe('blocked')
  // Chat may use the rest of the cap, and no more.
  expect(ledger.reserve('chat', dollars(1.4)).kind).toBe('reserved')
  expect(ledger.reserve('chat', 1).kind).toBe('blocked')
  invariant()
})

it('records a cost above its reservation as reported, and refuses new spend until the day is back under its cap or raised', async () => {
  const guard = h.guard()
  const { revision, context } = request()
  // The provider counts far more input than the byte bound allowed: $2 at Sonnet's input price.
  h.fake.script([reply('Done.', { usage: { input: 1_000_000, output: 10 } })])
  const answered = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, context))
  expect(answered.stopReason).toBe('stop')
  const reported = dollars(answered.usage.cost.total)
  const s = ledger.snapshot()
  expect(s.actual).toBe(reported)
  expect(s.actual).toBeGreaterThan(s.cap)
  // At or over the cap nothing is reserved, not even a zero amount, on any path.
  for (const path of ['chat', 'subagent', 'compaction'] as const) expect(ledger.reserve(path, 0)).toEqual({ kind: 'blocked', reason: 'budget' })
  h.fake.script([reply('Not sent.')])
  const blocked = await guard.models.completeSimple(h.model, guard.stamp(revision, h.model, request('again').context))
  expect(blocked.errorMessage).toBe('JUNO:blocked:budget')
  expect(h.fake.pending()).toBe(1)
  // About $2.0001 was spent, so the owner's $1 raise leaves room again.
  ledger.allowDollar('owner-click')
  expect(ledger.reserve('chat', dollars(0.5)).kind).toBe('reserved')
  h.nextDay()
  expect(ledger.reserve('chat', dollars(1)).kind).toBe('reserved')
})

it('keeps a reservation when the cap is lowered, settles it, and admits again tomorrow', () => {
  const reservation = ledger.reserve('chat', dollars(1))
  if (reservation.kind !== 'reserved') throw new Error('Expected a reservation')
  expect(ledger.setCap(dollars(0.5))).toBe(true)
  expect(ledger.snapshot()).toMatchObject({ cap: dollars(0.5), reserved: dollars(1) })
  expect(ledger.reserve('chat', 0).kind).toBe('blocked')
  ledger.settle(reservation.id, dollars(0.75))
  expect(ledger.snapshot()).toMatchObject({ actual: dollars(0.75), reserved: 0 })
  expect(ledger.reserve('chat', 0).kind).toBe('blocked')
  h.nextDay()
  expect(ledger.reserve('chat', dollars(0.25)).kind).toBe('reserved')
})

it('stops the engine backlog at three quarters of the engine half, leaving the rest for new threads and Redraw (spec engineBackground)', () => {
  expect(ledger.reserve('engine', dollars(0.5), 'backlog-1', true).kind).toBe('reserved')
  expect(ledger.reserve('engine', dollars(0.3), 'backlog-2', true).kind).toBe('blocked')
  // A foreground engine call, such as a new thread's title, still fits in the half.
  expect(ledger.reserve('engine', dollars(0.4), 'title-1').kind).toBe('reserved')
  // And while the engine holds that much, the backlog waits.
  expect(ledger.reserve('engine', 1, 'backlog-3', true).kind).toBe('blocked')
  invariant()
})

it('says it may have room again when the cap goes up, on a raise, and on a release after a refusal, and not otherwise', () => {
  let rooms = 0
  const stop = ledger.onRoom(() => { rooms++ })
  ledger.setCap(dollars(1))
  const held = ledger.reserve('engine', dollars(0.4))
  if (held.kind !== 'reserved') throw new Error('expected a reservation')
  // A release with no refusal before it, and a lower cap, change nothing for a waiting job.
  const other = ledger.reserve('chat', dollars(0.1))
  if (other.kind === 'reserved') ledger.settle(other.id, dollars(0.05))
  ledger.setCap(dollars(0.5))
  expect(rooms).toBe(0)
  // The engine's half is used up: refused. Its release then makes room.
  expect(ledger.reserve('engine', dollars(0.2)).kind).toBe('blocked')
  ledger.settle(held.id, dollars(0.1))
  expect(rooms).toBe(1)
  ledger.setCap(dollars(3))
  ledger.allowDollar('raise-room')
  ledger.allowDollar('raise-room')
  expect(rooms).toBe(3)
  stop()
  ledger.setCap(dollars(4))
  expect(rooms).toBe(3)
})

it('counts what the cap counts: a reservation left open or settled unknown is spent today, so a refusal never shows $0', () => {
  const open = ledger.reserve('engine', dollars(0.4))
  const unknown = ledger.reserve('engine', dollars(0.3))
  const known = ledger.reserve('engine', dollars(0.2))
  if (open.kind !== 'reserved' || unknown.kind !== 'reserved' || known.kind !== 'reserved') throw new Error('expected room')
  ledger.settle(unknown.id, undefined)
  ledger.settle(known.id, dollars(0.01))
  const s = ledger.snapshot()
  // Settings › AI activity shows `reserved + actual`, the sum `fits` checks.
  expect(s.reserved + s.actual).toBe(dollars(0.4) + dollars(0.3) + dollars(0.01))
  expect(s.engine).toBe(s.reserved + s.actual)
  // The engine's half of $2 is $1: $0.71 held, so $0.3 more does not fit, and the page shows $0.71 of it.
  expect(ledger.reserve('engine', dollars(0.3)).kind).toBe('blocked')
  expect(ledger.reserve('engine', dollars(0.29)).kind).toBe('reserved')
})
