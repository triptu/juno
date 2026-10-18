import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { millisToTs, Ts } from '@juno/domain'
import { bootedEngine, readDb, restart, seedThread, DAY } from './scenario'
import { waitFor, type RunningEngine } from './harness'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function message(engine: RunningEngine, channel: string, ts: string) {
  return readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, deleted FROM messages WHERE channel = ? AND ts = ?').get(channel, ts))
}

it('retains queued work when one repair range is refused and retries it after restart', async () => {
  const engine = await bootedEngine(engines, { followPassMillis: 3_600_000, recheckTopics: 0 })
  const marker = () => readDb(engine, 'cache.db', (db) => db.prepare(
    "SELECT updated, history_invalid FROM conversation_repairs WHERE channel = 'C0ENG'",
  ).get())
  const before = marker()
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Repair must retry.' })
  engine.fake.forceError({ method: 'conversations.history', error: 'not_allowed', times: 1 })
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBeGreaterThan(0)
  const warm = await restart(engines, engine, () => {}, { followPassMillis: 3_600_000 })
  expect(warm.fake.calls.some((c) => c.args['_x_reason'] === 'mutation-repair' && c.args.channel === 'C0ENG')).toBe(true)
  expect(message(warm, 'C0ENG', target.ts)?.text).toBe('Repair must retry.')
  expect(marker()).not.toEqual(before)
})

it('repairs a deletion when only history_invalid advances', async () => {
  const engine = await bootedEngine(engines, { followPassMillis: 3_600_000, recheckTopics: 0 })
  const before = engine.fake.workspace.countEntry(engine.fake.workspace.conversations.get('C0ENG')!)
  const stored = readDb(engine, 'cache.db', (db) => db.prepare(
    "SELECT ts FROM messages WHERE channel = 'C0ENG' AND thread_ts IS NULL AND deleted = 0 AND reply_count = 0 LIMIT 1",
  ).get())
  if (stored === undefined) throw new Error('seed needs a cached Main message')
  const target = { ts: Ts.make(String(stored.ts)) }
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.deleteMessage({ channel: 'C0ENG', ts: target.ts })
  engine.fake.workspace.mutationUpdated.set('C0ENG', Ts.make(before.updated!))
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(message(engine, 'C0ENG', target.ts)?.deleted).toBe(1)
  expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'mutation-repair')).toBe(true)
  expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'recheck')).toBe(false)
})

it('seeds missing upgrade markers without repairing the whole cache', async () => {
  const engine = await bootedEngine(engines)
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
  db.exec('DELETE FROM conversation_repairs')
  db.close()
  const warm = await restart(engines, engine)
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')).toHaveLength(0)
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'recheck')).toHaveLength(10)
  expect(readDb(warm, 'cache.db', (cache) => cache.prepare('SELECT count(*) AS n FROM conversation_repairs').get())?.n).toBeGreaterThan(0)
})

it('caps repair at ten pages after live, carries leftovers across restart, and excludes an old root', async () => {
  const roots: string[] = []
  let oldRoot = ''
  const engine = await bootedEngine(engines, { recheckTopics: 0, initial: (fake) => {
    oldRoot = seedThread(fake, { channel: 'C0ENG', text: 'Old root', ago: 800 * DAY, replies: [60_000], follow: true }).ts
    for (let i = 0; i < 14; i++) roots.push(seedThread(fake, { channel: 'C0ENG', text: `Recent thread ${i}`, ago: 120_000, replies: [30_000], follow: true }).ts)
    return fake.signIn()
  } })
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: roots[0]!, text: 'Changed marker' })
  engine.fake.holdNext({ method: 'conversations.history', reason: 'mutation-repair' })
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await waitFor(() => engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined, 30_000, 'background repair held after live')
  engine.fake.release()
  await engine.syncIdle()
  const repairs = engine.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')
  expect(repairs).toHaveLength(10)
  for (const call of repairs.filter((c) => c.method === 'conversations.replies')) {
    expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages WHERE channel = ? AND thread_ts = ? AND ts <> ?').get(call.args.channel!, call.args.ts!, call.args.ts!))?.n).toBeGreaterThan(0)
  }
  expect(repairs.every((c) => Number(c.args.oldest) > Number(oldRoot))).toBe(true)
  expect(message(engine, 'C0ENG', oldRoot)?.deleted).toBe(0)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBeGreaterThan(0)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0 })
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')).toHaveLength(9)
  expect(readDb(warm, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBe(0)
  expect(message(warm, 'C0ENG', oldRoot)?.deleted).toBe(0)
})

it('repairs backwards markers and preserves baselines when markers are absent', async () => {
  const engine = await bootedEngine(engines, { recheckTopics: 0 })
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.workspace.mutationUpdated.set('C0ENG', Ts.make('1.000000'))
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'mutation-repair')).toBe(true)
  const marker = readDb(engine, 'cache.db', (db) => db.prepare("SELECT updated FROM conversation_repairs WHERE channel = 'C0ENG'").get())
  expect(marker?.updated).toBe('1.000000')
  const warm = await restart(engines, engine, (fake) => { fake.workspace.mutationMarkers = false }, { recheckTopics: 0 })
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')).toHaveLength(0)
  expect(readDb(warm, 'cache.db', (db) => db.prepare("SELECT updated FROM conversation_repairs WHERE channel = 'C0ENG'").get())).toEqual(marker)
})

it('keeps messages hidden by a limited page and retries a rate-limited range later', async () => {
  const engine = await bootedEngine(engines, { recheckTopics: 0 })
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  const before = message(engine, 'C0ENG', target.ts)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Behind retention limit' })
  engine.fake.workspace.retainedSince.set('C0ENG', millisToTs(Date.now() + DAY))
  engine.fake.force429({ method: 'conversations.history', retryAfter: 0, times: 1 })
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(message(engine, 'C0ENG', target.ts)).toEqual(before)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBeGreaterThan(0)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0 })
  expect(message(warm, 'C0ENG', target.ts)?.deleted).toBe(0)
  expect(readDb(warm, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBe(0)
})

it.each([false, true])('keeps the fallback when a reaction version stays fixed (marker moves: %s)', async (markerMoves) => {
  const engine = await bootedEngine(engines)
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  engine.fake.addReaction({ channel: 'C0ENG', ts: target.ts, name: 'eyes', user: engine.fake.workspace.selfId })
  await waitFor(() => readDb(engine, 'cache.db', (db) => db.prepare("SELECT 1 FROM reactions WHERE channel = 'C0ENG' AND ts = ? AND name = 'eyes'").get(target.ts)), 20_000, 'reaction stored')
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  engine.fake.goOffline()
  await engine.phase('offline')
  const marker = engine.fake.workspace.mutationUpdated.get('C0ENG')!
  const version = engine.fake.workspace.messageVersions.get(`C0ENG:${target.ts}`)!
  engine.fake.removeReaction({ channel: 'C0ENG', ts: target.ts, name: 'eyes', user: engine.fake.workspace.selfId })
  if (!markerMoves) engine.fake.workspace.mutationUpdated.set('C0ENG', marker)
  engine.fake.workspace.messageVersions.set(`C0ENG:${target.ts}`, version)
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(engine.fake.calls.filter((c) => c.args['_x_reason'] === 'recheck')).toHaveLength(10)
  expect(readDb(engine, 'cache.db', (db) => db.prepare("SELECT 1 FROM reactions WHERE channel = 'C0ENG' AND ts = ? AND name = 'eyes'").get(target.ts))).toBeUndefined()
})

it('repairs a Friday 17:00 edit made Saturday after closing Friday 18:00 and reopening Monday', async () => {
  const monday = Date.now()
  const friday = monday - 3 * DAY
  let ts = ''
  const engine = await bootedEngine(engines, { fakeOptions: { now: friday }, recheckTopics: 0, initial: (fake) => {
    ts = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Friday 17:00', at: friday - 3_600_000, silent: true }).ts
    return fake.signIn()
  } })
  expect(message(engine, 'C0ENG', ts)?.text).toBe('Friday 17:00')
  const warm = await restart(engines, engine, (fake) => {
    const db = new DatabaseSync(join(engine.userData, 'workspaces', fake.teamId, 'cache.db'))
    db.prepare("UPDATE sync_state SET value_json = json_set(value_json, '$.lastSyncAt', ?) WHERE key = 'boot'").run(friday)
    db.close()
    fake.advanceClock({ millis: DAY })
    fake.editMessage({ channel: 'C0ENG', ts, text: 'Saturday edit' })
    fake.advanceClock({ millis: 2 * DAY })
  }, { recheckTopics: 0 })
  expect(message(warm, 'C0ENG', ts)?.text).toBe('Saturday edit')
  const repairs = warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')
  expect(repairs.some((c) => c.args.channel === 'C0ENG' && Number(c.args.oldest) <= Number(ts))).toBe(true)
  expect(repairs.every((c) => c.args.oldest === millisToTs(friday - DAY))).toBe(true)
  expect(readDb(warm, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBe(0)
})

it('tombstones bounded cached replies and drops the job when its root no longer exists', async () => {
  let root = ''
  let reply = ''
  const engine = await bootedEngine(engines, { recheckTopics: 0, initial: (fake) => {
    root = seedThread(fake, { channel: 'C0ENG', text: 'Root to delete', ago: 120_000, replies: [60_000], follow: true }).ts
    reply = fake.workspace.replies('C0ENG', Ts.make(root))[0]!.ts
    return fake.signIn()
  } })
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.deleteMessage({ channel: 'C0ENG', ts: reply })
  engine.fake.deleteMessage({ channel: 'C0ENG', ts: root })
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(1)
  expect(message(engine, 'C0ENG', root)?.deleted).toBe(1)
  expect(engine.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair' && c.args.ts === root)).toHaveLength(1)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending').get())?.n).toBe(0)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0 })
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')).toHaveLength(0)
})

it('drops an inaccessible old thread without tombstoning its cached recent replies', async () => {
  let root = ''
  let reply = ''
  const engine = await bootedEngine(engines, { recheckTopics: 0, followPassMillis: DAY, initial: (fake) => {
    root = seedThread(fake, { channel: 'C0ENG', text: 'Old root', ago: 40 * DAY, replies: [60_000], follow: true }).ts
    reply = fake.workspace.replies('C0ENG', Ts.make(root))[0]!.ts
    return fake.signIn()
  } })
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: reply, text: 'Hidden by plan' })
  engine.fake.gate((method, args) => method === 'conversations.replies' && args.ts === root && args['_x_reason'] === 'mutation-repair')
  engine.fake.goOnline()
  await waitFor(() => engine.fake.gated().length > 0 ? true : undefined, 30_000, 'thread repair gated')
  for (const call of engine.fake.gated()) engine.fake.decide(call.id, { error: 'thread_not_found' })
  await waitFor(() => engine.fake.gated().some((c) => c.stage === 'answer') ? true : undefined, 30_000, 'missing-thread answer')
  engine.fake.gate()
  await engine.syncIdle()
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM repair_pending WHERE thread = ?').get(root))?.n).toBe(0)
})
