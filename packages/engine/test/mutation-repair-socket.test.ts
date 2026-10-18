import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { bootedEngine, readDb, DAY } from './scenario'
import { waitFor, type RunningEngine } from './harness'
import { controlledClock } from './controlledClock'
import { productionTiming } from '../src/config'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function message(engine: RunningEngine, channel: string, ts: string) {
  return readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, deleted FROM messages WHERE channel = ? AND ts = ?').get(channel, ts))
}

it('does not refresh a sweep baseline across a socket gap while counts is in flight', async () => {
  const engine = await bootedEngine(engines, { timing: { sweepIntervalMillis: 500, followPassMillis: DAY }, recheckTopics: 0 })
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  engine.fake.holdNext({ method: 'client.counts', before: true })
  await waitFor(() => engine.fake.heldCount({ method: 'client.counts' }) === 1 ? true : undefined, 20_000, 'sweep counts held')
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Edited during held counts' })
  engine.fake.goOnline()
  engine.fake.release()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  await waitFor(() => message(engine, 'C0ENG', target.ts)?.text === 'Edited during held counts' ? true : undefined, 30_000, 'gap edit repaired')
  expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'mutation-repair' && c.args.channel === 'C0ENG')).toBe(true)
})

it('repairs an edit lost on a half-open socket despite sweeps before timeout detection [TestClock]', async () => {
  const time = await controlledClock()
  const pongTimeout = productionTiming.socketPongTimeoutMillis
  const engine = await bootedEngine(engines, { clock: time.clock, timing: { sweepIntervalMillis: 500, followPassMillis: DAY, socketPongTimeoutMillis: pongTimeout }, recheckTopics: 0 })
  try {
    const target = engine.fake.workspace.main('C0ENG').at(-1)!
    const baseline = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT updated FROM conversation_repairs WHERE channel = ?').get('C0ENG'))?.updated
    const before = baseline()
    await time.freeze()
    engine.fake.holdFrames({ types: ['message', 'pong'] })
    engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Lost before timeout' })
    for (let sweep = 0; sweep < 2; sweep++) {
      const finished = engine.nextSync()
      await time.advance(500)
      await finished
    }
    expect(engine.online()).toBe(true)
    expect(baseline()).toBe(before)
    expect(message(engine, 'C0ENG', target.ts)?.text).not.toBe('Lost before timeout')
    await time.advance(pongTimeout + 500)
    await engine.phase('offline')
    engine.fake.releaseFrames({ drop: true })
    await time.advance(500)
    await engine.phase('live')
    await engine.syncIdle()
    await waitFor(() => message(engine, 'C0ENG', target.ts)?.text === 'Lost before timeout' ? true : undefined, 30_000, 'half-open edit repaired')
    expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'mutation-repair' && c.args.channel === 'C0ENG')).toBe(true)
  } finally {
    await engine.stop()
    engines.splice(engines.indexOf(engine), 1)
    await time.close()
  }
}, 90_000)

it('does not promote a conversation baseline after applying its frame fails', async () => {
  let ts = ''
  const engine = await bootedEngine(engines, { timing: { sweepIntervalMillis: 500, followPassMillis: DAY }, recheckTopics: 0, initial: (fake) => {
    ts = fake.injectMessage({ channel: 'C0ENG', text: 'Before failed frame' }).ts
    return fake.signIn()
  } })
  const baseline = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT updated FROM conversation_repairs WHERE channel = ?').get('C0ENG'))?.updated
  const before = baseline()
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
  try {
    db.exec("CREATE TRIGGER refuse_frame BEFORE UPDATE ON messages WHEN NEW.text = 'Failed frame edit' BEGIN SELECT RAISE(FAIL, 'test frame failure'); END")
    let pongs = 0
    engine.fake.holdFramesWhere((frame) => { if (frame.type === 'pong') pongs++; return false })
    engine.fake.editMessage({ channel: 'C0ENG', ts, text: 'Failed frame edit' })
    await engine.nextSync()
    await waitFor(() => pongs > 0 ? true : undefined, 20_000, 'pong after failed frame')
    await engine.nextSync()
    expect(baseline()).toBe(before)
    expect(message(engine, 'C0ENG', ts)?.text).toBe('Before failed frame')
    db.exec('DROP TRIGGER refuse_frame')
    engine.fake.goOffline()
    await engine.phase('offline')
    engine.fake.goOnline()
    await engine.phase('live', 30_000)
    await engine.syncIdle()
    expect(message(engine, 'C0ENG', ts)?.text).toBe('Failed frame edit')
  } finally {
    db.exec('DROP TRIGGER IF EXISTS refuse_frame')
    db.close()
  }
}, 60_000)
