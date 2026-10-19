// Huddle recovery (specs/huddle.qnt): running huddles after socket gaps, a
// renderer page that reloads mid-call, shutdown while a join is out, a store
// that cannot be read, and an abrupt crash. Page lifetimes against the
// engine's are in huddle-pages.test.ts.
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sleep, waitFor, WAIT_MS } from './harness'
import { readDb, restart, valueOf } from './scenario'
import {
  booted, callOrder, callUntil, inCall, joined, joins, leftAttendees, PAGE, PAGE2, pagesLive, recordOf, runningUntil, start, started, stopHuddleEnginesAfterEach,
  storedLeaves, track, watchHuddles, writeStoredLeaves,
} from './huddleScenario'

stopHuddleEnginesAfterEach()

const cleared = (engine: Parameters<typeof storedLeaves>[0], label: string) =>
  waitFor(() => ((storedLeaves(engine) as Array<unknown> | undefined)?.length === 0 ? true : undefined), WAIT_MS, label)

it('reads running huddles again after a reconnect, and drops a read a gap overtook', async () => {
  const engine = await booted()
  await runningUntil(engine, (running) => Object.keys(running).length === 0, 'none running')
  // Leo starts one while Juno is offline: no frame reaches it.
  engine.fake.goOffline()
  engine.fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  engine.fake.goOnline()
  await waitFor(() => (engine.fake.heldCount({ method: 'edge:huddles/info' }) === 1 ? true : undefined), WAIT_MS, 'the read after reconnect out')
  // While that read is out, another gap: Leo leaves and the huddle ends unseen.
  engine.fake.goOffline()
  engine.fake.control('leaveHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  engine.fake.goOnline()
  await waitFor(() => (engine.fake.socketCount() > 0 ? true : undefined), WAIT_MS, 'reconnected')
  engine.fake.release()
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  await waitFor(() => (engine.fake.heldCount({ method: 'edge:huddles/info' }) === 1 ? true : undefined), WAIT_MS, 'the read again')
  // The first answer listed Leo's huddle, but a gap came after it was asked: it was dropped.
  expect((await runningUntil(engine, () => true, 'running'))['C0PRODUCT']).toBeUndefined()
  engine.fake.release()

  engine.fake.goOffline()
  engine.fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  engine.fake.goOnline()
  const running = await runningUntil(engine, (r) => r['C0PRODUCT'] !== undefined, 'read after reconnect')
  expect(running['C0PRODUCT']?.participants).toEqual(['U0LEO'])
})

it('ends the call when main says the page reloaded, ignores the old page, and joins from the new one', async () => {
  const engine = await booted()
  pagesLive(engine, PAGE)
  const first = await inCall(engine, 'C0ENG')
  // The page reloads: main says PAGE is gone and the new PAGE2 is live. Chime lost the attendee with the page.
  pagesLive(engine, PAGE2)
  engine.fake.control('stopMedia', { attendeeId: first.attendeeId })
  const call = await callUntil(engine, (c) => c.phase === 'idle', 'the call ended')
  expect(call.ended).toEqual({ channelId: 'C0ENG', reason: 'connectionLost' })
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the leave sent')
  await cleared(engine, 'cleared: the page that held it is gone')
  // A late report from the old page, and a Start from it, change nothing.
  await started(engine, first.attendeeId)
  expect(valueOf(await start(engine, 'C0ENG'))).toEqual({ _tag: 'cancelled' })
  const second = await joined(engine, 'C0ENG', PAGE2)
  await started(engine, second.attendeeId, PAGE2)
  await callUntil(engine, (c) => c.phase === 'joined' && c.attendeeId === second.attendeeId, 'joined from the new page')
})

it('handles a join answered while the engine shuts down: stored, left, and never handed out', async () => {
  const engine = await booted()
  engine.fake.holdNext({ method: 'rooms.join' })
  void start(engine, 'C0ENG').catch(() => undefined)
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  const stopping = engine.handle.stop()
  await sleep(300)
  engine.fake.release()
  await stopping
  // The fake's first attendee: the one the held answer carried.
  expect(leftAttendees(engine)).toEqual(['fake-attendee-1'])
  // Never handed to a page, and its leave went out: nothing is left stored.
  expect(readDb(engine, 'user.db', (db) => db.prepare('SELECT value_json FROM prefs WHERE key = ?').get('huddle.pendingLeaves'))).toEqual({ value_json: '[]' })
})

it('holds joins back while the stored leaves are malformed or null, and goes on once they read', async () => {
  const engine = await booted()
  const next = watchHuddles(await restart(track, engine, () => writeStoredLeaves(engine.userData, engine.fake.teamId, 'not json {')))
  pagesLive(next, PAGE)
  const starting = start(next, 'C0ENG')
  await callUntil(next, (call) => call.phase === 'joining', 'joining')
  await sleep(1_500)
  expect(joins(next)).toHaveLength(0)
  // A stored null is not an empty list either.
  writeStoredLeaves(next.userData, next.fake.teamId, 'null')
  await sleep(2_500)
  expect(joins(next)).toHaveLength(0)
  // Readable now: the next read finds no leave, and the join goes.
  writeStoredLeaves(next.userData, next.fake.teamId, '[]')
  expect(valueOf(await starting)._tag).toBe('joined')
})

it('after an abrupt crash, sends the stored leave before any new join, once main says the old page is gone', async () => {
  const engine = await booted()
  pagesLive(engine, PAGE)
  const first = await inCall(engine, 'C0ENG')
  // The store as it is at the crash: a consistent copy, put back after the engine stopped, so nothing done at shutdown counts.
  const dir = join(engine.userData, 'workspaces', engine.fake.teamId)
  const snapshot = join(engine.userData, 'crash-user.db')
  readDb(engine, 'user.db', (db) => db.exec(`VACUUM INTO '${snapshot}'`))
  const next = watchHuddles(await restart(track, engine, () => {
    for (const suffix of ['-wal', '-shm']) rmSync(join(dir, `user.db${suffix}`), { force: true })
    copyFileSync(snapshot, join(dir, 'user.db'))
  }))
  expect(storedLeaves(next)).toEqual([recordOf(first)])
  await waitFor(() => (leftAttendees(next).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the stored leave sent again')
  const starting = start(next, 'C0PRODUCT', PAGE2)
  await sleep(500)
  // The old page may still be running its media until main says otherwise.
  expect(joins(next)).toHaveLength(0)
  pagesLive(next, PAGE2)
  expect(valueOf(await starting)._tag).toBe('joined')
  expect(callOrder(next).indexOf('rooms.leave')).toBeLessThan(callOrder(next).indexOf('rooms.join'))
})
