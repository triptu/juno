import { afterEach, expect, it } from 'vitest'
import { largeSeed } from '@juno/fake-slack'
import { millisToTs } from '@juno/domain'
import { bootedEngine, readDb, DAY } from './scenario'
import { waitFor, type RunningEngine } from './harness'

const engines: RunningEngine[] = []
afterEach(async () => { for (const engine of engines.splice(0)) await engine.stop() })

it('measures six live ten-minute intervals before a real offline edit on the large seed', async () => {
  const engine = await bootedEngine(engines, { fakeOptions: { seed: largeSeed() }, sweepIntervalMillis: 500, followPassMillis: DAY, recheckTopics: 0 }, 120_000)
  const targets = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT m.channel, max(m.ts) AS ts
    FROM messages m JOIN conversations c ON c.id = m.channel WHERE c.is_member = 1 AND c.is_archived = 0
      AND m.deleted = 0 AND m.partial = 0 AND m.ts >= ? GROUP BY m.channel ORDER BY m.channel LIMIT 150`).all(millisToTs(Date.now() - DAY)))
  expect(targets).toHaveLength(150)
  for (let interval = 1; interval <= 6; interval++) {
    engine.fake.advanceClock({ millis: 10 * 60_000 })
    for (const target of targets) engine.fake.editMessage({ channel: String(target.channel), ts: String(target.ts), text: `Live interval ${interval}` })
    await waitFor(() => readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages WHERE text = ?').get(`Live interval ${interval}`))?.n === 150 ? true : undefined, 120_000, 'all live edits stored')
    await engine.nextSync(120_000)
  }
  engine.fake.goOffline()
  await engine.phase('offline')
  const target = targets.at(-1)!
  engine.fake.editMessage({ channel: String(target.channel), ts: String(target.ts), text: 'Real offline edit' })
  engine.fake.holdNext({ method: 'conversations.history', reason: 'mutation-repair' })
  engine.fake.holdNext({ method: 'conversations.replies', reason: 'mutation-repair' })
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 120_000)
  await waitFor(() => engine.fake.heldCount() > 0 ? true : undefined, 120_000, 'repair held for queue measurement')
  const queued = readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS jobs, count(DISTINCT channel) AS conversations FROM repair_pending').get())
  engine.fake.release()
  await engine.syncIdle()
  const repaired = readDb(engine, 'cache.db', (db) => db.prepare('SELECT text FROM messages WHERE channel = ? AND ts = ?').get(String(target.channel), String(target.ts)))?.text === 'Real offline edit'
  const calls = engine.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair').length
  expect({ queued, calls, repaired }).toEqual({ queued: { jobs: 2, conversations: 1 }, calls: 2, repaired: true })
  console.info('active hour queue', { queued, calls, repaired })
}, 240_000)
