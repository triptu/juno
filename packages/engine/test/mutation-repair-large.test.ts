import { afterEach, expect, it } from 'vitest'
import { mutationSeed } from './mutationSeed'
import { millisToTs } from '@juno/domain'
import { bootedEngine, readDb, restart, DAY } from './scenario'
import { waitFor, type RunningEngine } from './harness'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function message(engine: RunningEngine, channel: string, ts: string) {
  return readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, deleted FROM messages WHERE channel = ? AND ts = ?').get(channel, ts))
}

it('repairs offline mutations outside the top ten on the large seed, without opening the topic', async () => {
  const engine = await bootedEngine(engines, { fakeOptions: { seed: mutationSeed() }, timing: { followPassMillis: 3_600_000 } }, 120_000)
  const target = readDb(engine, 'cache.db', (db) => db.prepare(`
    SELECT m.channel, m.thread_ts FROM messages m JOIN conversations c ON c.id = m.channel
    WHERE m.thread_ts IS NOT NULL AND m.thread_ts <> m.ts AND m.deleted = 0 AND m.partial = 0
      AND c.is_member = 1 AND c.is_archived = 0 AND m.ts >= '${millisToTs(Date.now() - DAY)}'
      AND ('t:' || m.channel || ':' || m.thread_ts) NOT IN
        (SELECT topic_id FROM topic_index ORDER BY last_activity_ts DESC LIMIT 10)
    GROUP BY m.channel, m.thread_ts HAVING count(*) >= 3 ORDER BY m.channel, m.thread_ts LIMIT 1
  `).get())
  if (target === undefined) throw new Error('seed needs a cached thread outside the fallback')
  const channel = String(target.channel)
  const root = String(target.thread_ts)
  const cached = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT ts FROM messages
    WHERE channel = ? AND thread_ts = ? AND ts <> ? AND deleted = 0 AND partial = 0 AND ts >= '${millisToTs(Date.now() - DAY)}' ORDER BY ts LIMIT 3`).all(channel, root, root))
  const [edited, deleted, reacted] = cached.map((m) => String(m.ts))
  if (edited === undefined || deleted === undefined || reacted === undefined) throw new Error('seed needs three cached replies')
  const unchanged = root
  engine.fake.addReaction({ channel, ts: reacted, name: 'eyes', user: engine.fake.workspace.selfId })
  await waitFor(() => readDb(engine, 'cache.db', (db) => db.prepare(
    "SELECT 1 FROM reactions WHERE channel = ? AND ts = ? AND name = 'eyes' AND me = 1",
  ).get(channel, reacted)), 20_000, 'initial reaction stored')
  const stable = message(engine, channel, unchanged)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel, ts: edited, text: 'Edited during the offline gap.' })
  engine.fake.deleteMessage({ channel, ts: deleted })
  engine.fake.removeReaction({ channel, ts: reacted, name: 'eyes', user: engine.fake.workspace.selfId })
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 120_000)
  await engine.syncIdle()
  expect(message(engine, channel, edited)?.text).toBe('Edited during the offline gap.')
  expect(message(engine, channel, deleted)?.deleted).toBe(1)
  expect(readDb(engine, 'cache.db', (db) => db.prepare(
    "SELECT 1 FROM reactions WHERE channel = ? AND ts = ? AND name = 'eyes' AND me = 1",
  ).get(channel, reacted))).toBeUndefined()
  expect(message(engine, channel, unchanged)).toEqual(stable)
  const repairs = engine.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')
  expect(new Set(repairs.map((c) => c.args.channel))).toEqual(new Set([channel]))
  expect(repairs.some((c) => c.method === 'conversations.replies' && c.args.ts === root)).toBe(true)
  expect(repairs.every((c) => c.args.cached_latest_updates !== undefined)).toBe(true)
  const budget = Object.fromEntries(['client.counts', 'conversations.history', 'conversations.replies', 'search.modules.messages', 'subscriptions.thread.getView'].map(
    (method) => [method, engine.fake.callCount(method)],
  ))
  // Running huddles are read after each connect (packages/huddle), apart from the repair's budget.
  const total = engine.fake.calls.filter((c) => c.method !== 'client.getWebSocketURL' && c.method !== 'huddles/info').length
  const fallback = engine.fake.calls.filter((c) => c.args['_x_reason'] === 'recheck').length
  expect({ budget, total, repair: repairs.length, fallback }).toEqual({
    // The ten fallback topics include one Main and nine threads on this seed.
    budget: { 'client.counts': 1, 'conversations.history': 1, 'conversations.replies': 12,
      'search.modules.messages': 2, 'subscriptions.thread.getView': 1 },
    total: 18, repair: 3, fallback: 10,
  })
  console.info('large seed reconnect calls', { budget, total, repair: repairs.length, fallback })
  // No new mutations: the durable markers avoid another repair on warm boot.
  const warm = await restart(engines, engine, () => {}, { timing: { followPassMillis: 3_600_000 } }, 120_000)
  expect(warm.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')).toHaveLength(0)
}, 240_000)
