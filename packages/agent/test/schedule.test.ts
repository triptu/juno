import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import fc from 'fast-check'
import { TEST_CHANNEL } from '@juno/agent-testing'
import { openDatabase } from '../src/store/database'
import { initialize } from '../src/store/store'
import { ACTIONS_MIGRATIONS } from '../src/actions/schema'
import { revokeAllGrants } from '../src/grants/grants'
import { SCHEDULE_MIGRATIONS } from '../src/schedule/schema'
import { createScheduler } from '../src/schedule/scheduler'
import { matchesReply, menuDeadline, nextDue, type Definition, type Reply } from '../src/schedule/rules'

const cleanups: Array<() => void> = []
afterEach(() => { for (const close of cleanups.splice(0)) close() })
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'juno-schedule-'))
  let now = Date.UTC(2026, 9, 16, 12)
  let db = openDatabase(join(dir, 'agent.sqlite'), [ACTIONS_MIGRATIONS, SCHEDULE_MIGRATIONS])
  const store = { get db() { return db }, now: () => now }
  initialize(store)
  let replies: Reply[] = []
  const options = { store, changed: () => {}, replies: async () => ({ owner: 'owner', messages: replies }) }
  let scheduler = createScheduler(options)
  const create = (definition: Partial<Definition> = {}) => {
    const row = scheduler.create({ key: `create:${now}`, sourceOp: `owner:${now}`, authority: { _tag: 'menu' },
      definition: { what: 'Catch up', prompt: 'Read the topic.', deliver: 'now', schedule: { _tag: 'once', at: now + 1000 }, ...definition } })
    if (row === undefined) throw new Error('Creation refused')
    return row
  }
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  return { store, get scheduler() { return scheduler }, create, advance: (ms: number) => { now += ms }, reply: (reply: Reply) => { replies.push(reply) },
    restart: () => { db.close(); db = openDatabase(join(dir, 'agent.sqlite'), [ACTIONS_MIGRATIONS, SCHEDULE_MIGRATIONS]); scheduler = createScheduler(options) } }
}
it('persists one occurrence and admits and starts it once across restart', async () => {
  const h = harness(); h.create(); h.advance(1000)
  h.scheduler.queue(); h.restart(); await h.scheduler.tick(); await h.scheduler.tick()
  const [occurrence] = h.scheduler.occurrences()
  expect(occurrence?.state).toBe('admitted')
  expect(h.store.db.prepare("SELECT * FROM inbox WHERE kind = 'wake'").all()).toHaveLength(1)
  h.restart()
  expect(h.scheduler.start(occurrence!.op_id)).toBe(true)
  h.restart()
  expect(h.scheduler.start(occurrence!.op_id)).toBe(false)
  await h.scheduler.tick()
  expect(h.scheduler.occurrences()).toHaveLength(1)
})
it.each(['queued', 'admitted'] as const)('cancel wins with a %s wake', async (phase) => {
  const h = harness(); const row = h.create(); h.advance(1000); h.scheduler.queue()
  if (phase === 'admitted') await h.scheduler.tick()
  const [occurrence] = h.scheduler.occurrences()
  h.scheduler.cancel(row.id, row.revision)
  expect(h.scheduler.admit(occurrence!.op_id)).toBe(false)
  expect(h.scheduler.start(occurrence!.op_id)).toBe(false)
})
it('Pause revokes authority; global Resume cannot restore it; explicit schedule Resume can', async () => {
  const h = harness(); const row = h.create(); h.advance(1000); await h.scheduler.tick()
  revokeAllGrants(h.store, 'pause')
  h.store.db.prepare("UPDATE control SET mode = 'paused'").run()
  expect(h.scheduler.start(h.scheduler.occurrences()[0]!.op_id)).toBe(false)
  h.store.db.prepare("UPDATE control SET mode = 'on'").run()
  expect(h.scheduler.start(h.scheduler.occurrences()[0]!.op_id)).toBe(false)
  expect(h.scheduler.page().page.schedules[0]?.state).toBe('paused')
  expect(h.scheduler.resume(row.id, row.revision, 'fresh-click')).toBe(true)
  await h.scheduler.tick()
  const latest = h.scheduler.occurrences().find((o) => o.revision === 2)
  expect(latest?.state).toBe('admitted')
  expect(h.scheduler.start(latest!.op_id)).toBe(true)
})
it('a reply cancels the watch at deadline without admitting a model run', async () => {
  const h = harness()
  h.create({ unlessReply: { channelId: TEST_CHANNEL, ts: '100.000001', threadTs: '100.000001', from: 'others' } })
  h.reply({ channelId: TEST_CHANNEL, ts: '101.000001', threadTs: '100.000001', userId: 'someone' })
  h.advance(1000); await h.scheduler.tick()
  expect(h.scheduler.occurrences()[0]?.state).toBe('cancelled')
  expect(h.store.db.prepare("SELECT * FROM inbox WHERE kind = 'wake'").all()).toHaveLength(0)
})
it('a reply after admission still cancels before start', async () => {
  const h = harness()
  h.create({ unlessReply: { channelId: TEST_CHANNEL, ts: '100', from: 'others' } })
  h.advance(1000); await h.scheduler.tick()
  h.scheduler.observe({ channelId: TEST_CHANNEL, ts: '101', userId: 'someone' }, 'owner')
  expect(h.scheduler.start(h.scheduler.occurrences()[0]!.op_id)).toBe(false)
})
it('coalesces missed repeating wakes into one and advances from the current time', async () => {
  const h = harness(); h.create({ schedule: { _tag: 'interval', everyMs: 1000 } }); h.advance(100_000)
  await h.scheduler.tick(); expect(h.scheduler.occurrences()).toHaveLength(1)
  expect(h.scheduler.start(h.scheduler.occurrences()[0]!.op_id)).toBe(true)
  await h.scheduler.tick(); expect(h.scheduler.occurrences()).toHaveLength(1)
  h.advance(1000); await h.scheduler.tick(); expect(h.scheduler.occurrences()).toHaveLength(2)
})
it('menu waits one notification day and moves an out-of-hours time to hours start', () => {
  const hours = { timeZone: 'UTC', weekdays: [1, 2, 3, 4, 5], start: 540, end: 1020 }
  expect(menuDeadline(Date.UTC(2026, 9, 16, 12), hours)).toBe(Date.UTC(2026, 9, 19, 12))
  expect(menuDeadline(Date.UTC(2026, 9, 16, 20), hours)).toBe(Date.UTC(2026, 9, 19, 9))
})
it('intervals are strictly future', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (now, everyMs) => {
    expect(nextDue({ _tag: 'interval', everyMs }, now)).toBeGreaterThan(now)
  }))
})
it('owners and older messages never count as a reply from others', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1000 }), (ts, delta) => {
    const watch = { channelId: TEST_CHANNEL, ts: String(ts), from: 'others' as const }
    expect(matchesReply(watch, { channelId: TEST_CHANNEL, ts: String(ts + delta), userId: 'owner' }, 'owner')).toBe(false)
    expect(matchesReply(watch, { channelId: TEST_CHANNEL, ts: String(ts - delta), userId: 'someone' }, 'owner')).toBe(false)
  }))
})

it.each(['queued', 'admitted'])('recovers after SIGKILL with a persisted %s occurrence', async (phase) => {
  const { runAgent } = await import('@juno/agent-testing')
  const { fileURLToPath } = await import('node:url')
  const h = harness()
  // A table stands for the router's run record, committed with start.
  h.store.db.exec('CREATE TABLE schedule_test_runs (op_id TEXT PRIMARY KEY) STRICT')
  const path = h.store.db.prepare('PRAGMA database_list').get()?.file
  if (typeof path !== 'string') throw new Error('Missing test database path')
  const { dirname } = await import('node:path')
  const program = fileURLToPath(new URL('./fixtures/schedule.ts', import.meta.url))
  const args = (step: string) => [program, dirname(path), step]
  const killed = await runAgent({ args: args(phase), timeoutMs: 30_000 })
  expect(killed.signal).toBe('SIGKILL')
  const resumed = await runAgent({ args: args('finish'), timeoutMs: 30_000 })
  expect(resumed.code, resumed.stderr).toBe(0)
  expect(JSON.parse(resumed.stdout)).toEqual({ started: true, occurrences: 1, runs: 1 })
  const again = await runAgent({ args: args('finish'), timeoutMs: 30_000 })
  expect(again.code, again.stderr).toBe(0)
  expect(JSON.parse(again.stdout)).toEqual({ started: false, occurrences: 1, runs: 1 })
})

it('repeating a page command after restart returns its result without changing the schedule again', () => {
  const h = harness(); const row = h.create()
  const pause = () => h.scheduler.command('pause-click', () => h.scheduler.cancel(row.id, row.revision, 'paused'))
  expect(pause()).toBe(true)
  h.restart()
  expect(pause()).toBe(true)
  expect(h.scheduler.get(row.id)?.revision).toBe(2)
})
