// Mutation repair (specs/mutation-repair.qnt): edits, deletes and reactions made in Slack while Juno could
// not hear them reach the store from Slack's per-conversation markers, outside the ten-topic recheck and
// without opening the topic, limited by retention, carried across a restart, and not repeated on the next
// start once done. The baseline is never promoted across a gap, a half-open socket or a failed frame.
// Tests with nothing seeded before the first sync start warm on the synced default workspace.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { millisToTs, Ts } from '@juno/domain'
import { productionTiming } from '../../src/config'
import { controlledClock, controlledSweeps } from '../controlledClock'
import { WAIT_MS, waitFor, type EngineOptions, type RunningEngine } from '../harness'
import { mutationSeed } from '../mutationSeed'
import { bootedEngine, DAY, readDb, restart, seedThread } from '../scenario'
import { syncedEngine, type SyncedOptions } from '../synced'

const engines: Array<RunningEngine> = []
const clocks: Array<{ readonly close: () => Promise<void> }> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const clock of clocks.splice(0)) await clock.close()
})

const synced = (options: SyncedOptions = {}) => syncedEngine(engines, { recheckTopics: 0, ...options })
const booted = (options: EngineOptions = {}, liveMillis?: number) => bootedEngine(engines, { recheckTopics: 0, ...options }, liveMillis)
const QUIET_FOLLOWS = { timing: { followPassMillis: 3_600_000 } }
const sweepClock = async () => {
  const sweeps = await controlledSweeps()
  clocks.push(sweeps)
  return sweeps
}

function message(engine: RunningEngine, channel: string, ts: string) {
  return readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, deleted FROM messages WHERE channel = ? AND ts = ?').get(channel, ts)) as { text: string; deleted: number } | undefined
}
const repairs = (engine: RunningEngine) => engine.fake.calls.filter((c) => c.args['_x_reason'] === 'mutation-repair')
const rechecks = (engine: RunningEngine) => engine.fake.calls.filter((c) => c.args['_x_reason'] === 'recheck')

/** Drops the socket, runs `whileOffline`, and waits for the catch-up to finish. */
async function offline(engine: RunningEngine, whileOffline: () => void): Promise<void> {
  engine.fake.goOffline()
  await engine.phase('offline')
  whileOffline()
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
}

/** A start with nothing new in Slack repairs nothing: the queue was drained and the markers kept. */
async function nothingLeftAtNextStart(engine: RunningEngine, options: EngineOptions = {}): Promise<RunningEngine> {
  const next = await restart(engines, engine, () => {}, { recheckTopics: 0, ...options })
  expect(repairs(next)).toEqual([])
  return next
}

it('repairs an edit and a deletion made during a drop, from the markers alone, and keeps a refused range for the next start', async () => {
  const engine = await synced(QUIET_FOLLOWS)
  const main = engine.fake.workspace.main('C0ENG')
  const edited = main.at(-1)!
  const deleted = main.find((m) => m.ts !== edited.ts && (m.reply_count ?? 0) === 0 && message(engine, 'C0ENG', m.ts)?.deleted === 0)!
  const marker = engine.fake.workspace.countEntry(engine.fake.workspace.conversations.get('C0ENG')!).updated!
  await offline(engine, () => {
    engine.fake.editMessage({ channel: 'C0ENG', ts: edited.ts, text: 'Repair must retry.' })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: deleted.ts })
    // Only history_invalid moves for the delete; the update marker stays where it was.
    engine.fake.workspace.mutationUpdated.set('C0ENG', Ts.make(marker))
    // The first repair page is refused.
    engine.fake.forceError({ method: 'conversations.history', error: 'not_allowed', times: 1 })
  })
  expect(rechecks(engine)).toEqual([])
  expect(message(engine, 'C0ENG', edited.ts)?.text).not.toBe('Repair must retry.')
  const warm = await restart(engines, engine, () => {}, QUIET_FOLLOWS)
  expect(repairs(warm).some((c) => c.args['channel'] === 'C0ENG')).toBe(true)
  expect(message(warm, 'C0ENG', edited.ts)?.text).toBe('Repair must retry.')
  expect(message(warm, 'C0ENG', deleted.ts)?.deleted).toBe(1)
  await nothingLeftAtNextStart(warm, QUIET_FOLLOWS)
})

it('repairs when a marker goes backwards, and leaves the baseline alone when Slack sends no markers', async () => {
  const engine = await synced()
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  await offline(engine, () => {
    engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Behind a backwards marker' })
    engine.fake.workspace.mutationUpdated.set('C0ENG', Ts.make('1.000000'))
  })
  expect(repairs(engine).length).toBeGreaterThan(0)
  expect(message(engine, 'C0ENG', target.ts)?.text).toBe('Behind a backwards marker')
  const warm = await restart(engines, engine, (fake) => { fake.workspace.mutationMarkers = false }, { recheckTopics: 0 })
  expect(repairs(warm)).toEqual([])
})

it('keeps messages a retention-limited page hides, and retries a rate-limited range at the next start', async () => {
  const engine = await synced()
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  const before = message(engine, 'C0ENG', target.ts)
  await offline(engine, () => {
    engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Behind retention limit' })
    engine.fake.workspace.retainedSince.set('C0ENG', millisToTs(Date.now() + DAY))
    engine.fake.force429({ method: 'conversations.history', retryAfter: 0, times: 1 })
  })
  expect(message(engine, 'C0ENG', target.ts)).toEqual(before)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0 })
  expect(message(warm, 'C0ENG', target.ts)?.deleted).toBe(0)
  await nothingLeftAtNextStart(warm)
})

for (const markerMoves of [false, true]) it(`falls back to the recheck when a reaction is removed with its version fixed (marker moves: ${markerMoves})`, async () => {
  const engine = await syncedEngine(engines)
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  const self = engine.fake.workspace.selfId
  const stored = () => readDb(engine, 'cache.db', (db) => db.prepare("SELECT 1 FROM reactions WHERE channel = 'C0ENG' AND ts = ? AND name = 'eyes'").get(target.ts))
  engine.fake.addReaction({ channel: 'C0ENG', ts: target.ts, name: 'eyes', user: self })
  await waitFor(() => stored(), WAIT_MS, 'reaction stored')
  // One drop with nothing changed, so the markers are current.
  await offline(engine, () => {})
  await offline(engine, () => {
    const marker = engine.fake.workspace.mutationUpdated.get('C0ENG')!
    const version = engine.fake.workspace.messageVersions.get(`C0ENG:${target.ts}`)!
    engine.fake.removeReaction({ channel: 'C0ENG', ts: target.ts, name: 'eyes', user: self })
    if (!markerMoves) engine.fake.workspace.mutationUpdated.set('C0ENG', marker)
    engine.fake.workspace.messageVersions.set(`C0ENG:${target.ts}`, version)
  })
  expect(rechecks(engine).length).toBeGreaterThan(0)
  expect(rechecks(engine).length).toBeLessThanOrEqual(10)
  expect(stored()).toBeUndefined()
})

it('caps repair at ten pages after live, carries the rest across a restart, and leaves out a root older than retention', async () => {
  const roots: Array<string> = []
  let oldRoot = ''
  const engine = await booted({
    initial: (fake) => {
      oldRoot = seedThread(fake, { channel: 'C0ENG', text: 'Old root', ago: 800 * DAY, replies: [60_000], follow: true }).ts
      for (let i = 0; i < 14; i++) roots.push(seedThread(fake, { channel: 'C0ENG', text: `Recent thread ${i}`, ago: 120_000, replies: [30_000], follow: true }).ts)
      return fake.signIn()
    },
  })
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: roots[0]!, text: 'Changed marker' })
  engine.fake.holdNext({ method: 'conversations.history', reason: 'mutation-repair' })
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  // Repair runs in the background after live.
  await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 30_000, 'background repair held after live')
  engine.fake.release()
  await engine.syncIdle()
  const first = repairs(engine)
  expect(first.length).toBeGreaterThan(0)
  expect(first.length).toBeLessThanOrEqual(10)
  // A thread repair is asked only for threads with cached replies, and never reaches back to the old root.
  for (const call of first.filter((c) => c.method === 'conversations.replies')) {
    expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages WHERE channel = ? AND thread_ts = ? AND ts <> ?').get(call.args['channel']!, call.args['ts']!, call.args['ts']!) as { n: number }).n).toBeGreaterThan(0)
  }
  expect(first.every((c) => Number(c.args['oldest']) > Number(oldRoot))).toBe(true)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0 })
  expect(repairs(warm).length).toBeGreaterThan(0)
  expect(message(warm, 'C0ENG', roots[0]!)?.text).toBe('Changed marker')
  expect(message(warm, 'C0ENG', oldRoot)?.deleted).toBe(0)
  await nothingLeftAtNextStart(warm)
})

it('repairs a Friday 17:00 edit made Saturday after closing Friday 18:00 and reopening Monday', async () => {
  const monday = Date.now()
  const friday = monday - 3 * DAY
  let ts = ''
  const engine = await booted({
    quietDays: 7,
    fakeOptions: { now: friday },
    initial: (fake) => {
      ts = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Friday 17:00', at: friday - 3_600_000, silent: true }).ts
      return fake.signIn()
    },
  })
  expect(message(engine, 'C0ENG', ts)?.text).toBe('Friday 17:00')
  const warm = await restart(engines, engine, (fake) => {
    // The engine ran on Monday's clock; the last sync is set back to Friday, when the app was closed.
    const db = new DatabaseSync(join(engine.userData, 'workspaces', fake.teamId, 'cache.db'))
    db.prepare("UPDATE sync_state SET value_json = json_set(value_json, '$.lastSyncAt', ?) WHERE key = 'boot'").run(friday)
    db.close()
    fake.advanceClock({ millis: DAY })
    fake.editMessage({ channel: 'C0ENG', ts, text: 'Saturday edit' })
    fake.advanceClock({ millis: 2 * DAY })
  }, { recheckTopics: 0 })
  expect(message(warm, 'C0ENG', ts)?.text).toBe('Saturday edit')
  // The repair reaches back to a day before the last sync, so it covers the edited message.
  expect(repairs(warm).some((c) => c.args['channel'] === 'C0ENG' && Number(c.args['oldest']) <= Number(ts))).toBe(true)
  expect(repairs(warm).every((c) => c.args['oldest'] === millisToTs(friday - DAY))).toBe(true)
})

it('tombstones cached replies and drops the job when the root no longer exists', async () => {
  let root = ''
  let reply = ''
  const engine = await booted({
    initial: (fake) => {
      root = seedThread(fake, { channel: 'C0ENG', text: 'Root to delete', ago: 120_000, replies: [60_000], follow: true }).ts
      reply = fake.workspace.replies('C0ENG', Ts.make(root))[0]!.ts
      return fake.signIn()
    },
  })
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  await offline(engine, () => {
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: reply })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: root })
  })
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(1)
  expect(message(engine, 'C0ENG', root)?.deleted).toBe(1)
  expect(repairs(engine).filter((c) => c.args['ts'] === root)).toHaveLength(1)
  await nothingLeftAtNextStart(engine)
})

it('drops a thread Slack no longer shows (thread_not_found) without tombstoning its cached recent replies', async () => {
  let root = ''
  let reply = ''
  const engine = await booted({
    timing: { followPassMillis: DAY },
    initial: (fake) => {
      root = seedThread(fake, { channel: 'C0ENG', text: 'Old root', ago: 40 * DAY, replies: [60_000], follow: true }).ts
      reply = fake.workspace.replies('C0ENG', Ts.make(root))[0]!.ts
      return fake.signIn()
    },
  })
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: reply, text: 'Hidden by plan' })
  engine.fake.gate((method, args) => method === 'conversations.replies' && args['ts'] === root && args['_x_reason'] === 'mutation-repair')
  engine.fake.goOnline()
  await waitFor(() => (engine.fake.gated().length > 0 ? true : undefined), 30_000, 'thread repair gated')
  for (const call of engine.fake.gated()) engine.fake.decide(call.id, { error: 'thread_not_found' })
  await waitFor(() => (engine.fake.gated().some((c) => c.stage === 'answer') ? true : undefined), 30_000, 'missing-thread answer')
  engine.fake.gate()
  await engine.syncIdle()
  expect(message(engine, 'C0ENG', reply)?.deleted).toBe(0)
  const warm = await restart(engines, engine, () => {}, { recheckTopics: 0, timing: { followPassMillis: DAY } })
  expect(repairs(warm).filter((c) => c.args['ts'] === root)).toEqual([])
})

it('repairs offline changes in a thread outside the top ten on the large seed, without opening it, and not again on the next start', async () => {
  const engine = await booted({ fakeOptions: { seed: mutationSeed() }, ...QUIET_FOLLOWS, recheckTopics: 10 }, 120_000)
  const since = millisToTs(Date.now() - DAY)
  const target = readDb(engine, 'cache.db', (db) => db.prepare(`
    SELECT m.channel, m.thread_ts FROM messages m JOIN conversations c ON c.id = m.channel
    WHERE m.thread_ts IS NOT NULL AND m.thread_ts <> m.ts AND m.deleted = 0 AND m.partial = 0
      AND c.is_member = 1 AND c.is_archived = 0 AND m.ts >= '${since}'
      AND ('t:' || m.channel || ':' || m.thread_ts) NOT IN (SELECT topic_id FROM topic_index ORDER BY last_activity_ts DESC LIMIT 10)
    GROUP BY m.channel, m.thread_ts HAVING count(*) >= 3 ORDER BY m.channel, m.thread_ts LIMIT 1
  `).get()) as { channel: string; thread_ts: string } | undefined
  if (target === undefined) throw new Error('seed needs a cached thread outside the recheck')
  const { channel, thread_ts: root } = target
  const cached = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT ts FROM messages
    WHERE channel = ? AND thread_ts = ? AND ts <> ? AND deleted = 0 AND partial = 0 AND ts >= '${since}' ORDER BY ts LIMIT 3`).all(channel, root, root)) as Array<{ ts: string }>
  const [edited, deleted, reacted] = cached.map((m) => m.ts)
  if (edited === undefined || deleted === undefined || reacted === undefined) throw new Error('seed needs three cached replies')
  const self = engine.fake.workspace.selfId
  const reaction = () => readDb(engine, 'cache.db', (db) => db.prepare("SELECT 1 FROM reactions WHERE channel = ? AND ts = ? AND name = 'eyes' AND me = 1").get(channel, reacted))
  engine.fake.addReaction({ channel, ts: reacted, name: 'eyes', user: self })
  await waitFor(() => reaction(), WAIT_MS, 'initial reaction stored')
  const unchanged = message(engine, channel, root)
  await offline(engine, () => {
    engine.fake.editMessage({ channel, ts: edited, text: 'Edited during the offline gap.' })
    engine.fake.deleteMessage({ channel, ts: deleted })
    engine.fake.removeReaction({ channel, ts: reacted, name: 'eyes', user: self })
  })
  expect(message(engine, channel, edited)?.text).toBe('Edited during the offline gap.')
  expect(message(engine, channel, deleted)?.deleted).toBe(1)
  expect(reaction()).toBeUndefined()
  expect(message(engine, channel, root)).toEqual(unchanged)
  // The repair reads only the changed conversation, with the cached versions, and the thread by its root.
  const repaired = repairs(engine)
  expect(new Set(repaired.map((c) => c.args['channel']))).toEqual(new Set([channel]))
  expect(repaired.some((c) => c.method === 'conversations.replies' && c.args['ts'] === root)).toBe(true)
  expect(repaired.every((c) => c.args['cached_latest_updates'] !== undefined)).toBe(true)
  expect(repaired.length).toBeLessThanOrEqual(10)
  expect(rechecks(engine).length).toBeLessThanOrEqual(10)
  // Never a call per conversation: 300 conversations, a few dozen calls at most.
  expect(engine.fake.calls.filter((c) => c.method !== 'client.getWebSocketURL' && c.method !== 'huddles/info').length).toBeLessThan(40)
  await nothingLeftAtNextStart(engine, { ...QUIET_FOLLOWS, recheckTopics: 10 })
// Slow: its setup is a first sync of all 300 conversations, which the repair budget needs; CPU, not a wait (1 s on a Mac, 3 to 5 s in the laptop's full run).
}, 10_000)

// The baseline is never promoted across a gap, a half-open socket or a failed frame.
it('does not refresh a sweep baseline across a socket gap while counts is in flight', async () => {
  const sweeps = await sweepClock()
  const engine = await synced({ clock: sweeps.clock, timing: { sweepIntervalMillis: sweeps.sweepIntervalMillis, followPassMillis: DAY } })
  const target = engine.fake.workspace.main('C0ENG').at(-1)!
  engine.fake.holdNext({ method: 'client.counts', before: true })
  await sweeps.start()
  await waitFor(() => (engine.fake.heldCount({ method: 'client.counts' }) === 1 ? true : undefined), 20_000, 'sweep counts held')
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Edited during held counts' })
  engine.fake.goOnline()
  engine.fake.release()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
  await waitFor(() => (message(engine, 'C0ENG', target.ts)?.text === 'Edited during held counts' ? true : undefined), 30_000, 'gap edit repaired')
  expect(repairs(engine).some((c) => c.args['channel'] === 'C0ENG')).toBe(true)
})

it('repairs an edit lost on a half-open socket despite sweeps before the timeout shows it [TestClock]', async () => {
  const time = await controlledClock()
  const pongTimeout = productionTiming.socketPongTimeoutMillis
  const engine = await synced({ clock: time.clock, timing: { sweepIntervalMillis: 500, followPassMillis: DAY, socketPongTimeoutMillis: pongTimeout } })
  try {
    const target = engine.fake.workspace.main('C0ENG').at(-1)!
    await time.freeze()
    engine.fake.holdFrames({ types: ['message', 'pong'] })
    engine.fake.editMessage({ channel: 'C0ENG', ts: target.ts, text: 'Lost before timeout' })
    for (let sweep = 0; sweep < 2; sweep++) {
      const finished = engine.nextSync()
      await time.advance(500)
      await finished
    }
    // The sweeps ran on a socket that still looked open, and did not take the lost edit as seen.
    expect(engine.online()).toBe(true)
    expect(message(engine, 'C0ENG', target.ts)?.text).not.toBe('Lost before timeout')
    // The pinger arms its next sleep only after each wake, so one large jump can pass over it: move one ping interval at a time.
    await waitFor(async () => {
      if (!engine.online()) return true
      await time.advance(500)
      return undefined
    }, WAIT_MS, 'pong timeout')
    await engine.phase('offline')
    engine.fake.releaseFrames({ drop: true })
    await time.advance(500)
    await engine.phase('live')
    await engine.syncIdle()
    await waitFor(() => (message(engine, 'C0ENG', target.ts)?.text === 'Lost before timeout' ? true : undefined), 30_000, 'half-open edit repaired')
    expect(repairs(engine).some((c) => c.args['channel'] === 'C0ENG')).toBe(true)
  } finally {
    await engine.stop()
    engines.splice(engines.indexOf(engine), 1)
    await time.close()
  }
})

it('does not promote a conversation baseline after applying its frame fails', async () => {
  const sweeps = await sweepClock()
  const engine = await synced({ clock: sweeps.clock, timing: { sweepIntervalMillis: sweeps.sweepIntervalMillis, followPassMillis: DAY } })
  const ts = engine.fake.injectMessage({ channel: 'C0ENG', text: 'Before failed frame' }).ts
  await waitFor(() => (message(engine, 'C0ENG', ts) === undefined ? undefined : true), WAIT_MS, 'the message stored')
  // A trigger stands in for a write that fails while the frame is applied.
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
  try {
    db.exec("CREATE TRIGGER refuse_frame BEFORE UPDATE ON messages WHEN NEW.text = 'Failed frame edit' BEGIN SELECT RAISE(FAIL, 'test frame failure'); END")
    let pongs = 0
    engine.fake.holdFramesWhere((frame) => { if (frame.type === 'pong') pongs++; return false })
    engine.fake.editMessage({ channel: 'C0ENG', ts, text: 'Failed frame edit' })
    await sweeps.sweep(engine)
    await waitFor(() => (pongs > 0 ? true : undefined), 20_000, 'pong after failed frame')
    await sweeps.sweep(engine)
    expect(message(engine, 'C0ENG', ts)?.text).toBe('Before failed frame')
    db.exec('DROP TRIGGER refuse_frame')
    // The next catch-up still sees the conversation as changed and repairs it.
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
})
