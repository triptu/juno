// Huddle recovery (specs/huddle.qnt): running huddles after socket gaps, a renderer page that reloads mid-call,
// shutdown while a join is out, an abrupt crash, a page that outlives the engine, and stores that cannot be read.
// A join that waits shows why in `huddle.call` (`waitingFor`), so "no join yet" is read from the engine's own
// decision, not after a pause. The call itself is in huddle-call.flow.test.ts.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'bun:test'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import {
  callOrder, callUntil, cleared, huddleScenario, joined, joins, leftAttendees, PAGE, PAGE2, pagesLive, recordOf, runningUntil, settled, start, storedLeaves,
  writeStoredLeaves,
} from '../huddleScenario'
import { readDb, valueOf } from '../scenario'
import { step } from '../step'

const { booted, endCall, inCall, report, restarted, started } = huddleScenario()

/** A Start that waits, and what for. */
const waitsFor = (engine: RunningEngine, waitingFor: 'store' | 'lastCall', label: string) =>
  callUntil(engine, (call) => call.phase === 'joining' && call.waitingFor === waitingFor, label)

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
  const starting = start(engine, 'C0ENG').then(valueOf).catch(() => 'dropped' as const)
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  const stopping = engine.handle.stop()
  // The engine cancels the Start as it stops, or interrupts it with its connection: either way no page gets the answer.
  const outcome = await settled(starting, 'the Start cancelled or dropped')
  expect(outcome === 'dropped' ? outcome : outcome._tag).not.toBe('joined')
  engine.fake.release()
  await stopping
  // The fake's first attendee: the one the held answer carried.
  expect(leftAttendees(engine)).toEqual(['fake-attendee-1'])
  // Never handed to a page, and its leave went out: nothing is left stored.
  expect(storedLeaves(engine)).toEqual([])
})

it('after an abrupt crash, sends the stored leave before any new join, once main says the old page is gone', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // The store as it is at the crash: a consistent copy, put back after the engine stopped, so nothing done at shutdown counts.
  const dir = join(engine.userData, 'workspaces', engine.fake.teamId)
  const snapshot = join(engine.userData, 'crash-user.db')
  readDb(engine, 'user.db', (db) => db.exec(`VACUUM INTO '${snapshot}'`))
  const next = await restarted(engine, () => {
    for (const suffix of ['-wal', '-shm']) rmSync(join(dir, `user.db${suffix}`), { force: true })
    copyFileSync(snapshot, join(dir, 'user.db'))
  })
  expect(storedLeaves(next)).toEqual([recordOf(first)])
  await waitFor(() => (leftAttendees(next).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the stored leave sent again')
  const starting = start(next, 'C0PRODUCT', PAGE2)
  // The old page may still be running its media until main says otherwise.
  await waitsFor(next, 'lastCall', 'waiting for the old page')
  expect(joins(next)).toHaveLength(0)
  pagesLive(next, PAGE2)
  expect(valueOf(await starting)._tag).toBe('joined')
  expect(callOrder(next).indexOf('rooms.leave')).toBeLessThan(callOrder(next).indexOf('rooms.join'))
})

it('counts a page report sent before the stored leaves loaded, after an engine restart', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // The restarted engine cannot read its store at first, so the page reports before the load.
  const next = await restarted(engine, () => writeStoredLeaves(engine.userData, engine.fake.teamId, 'not json {'))
  pagesLive(next, PAGE)
  const starting = start(next, 'C0PRODUCT')

  await step('a Start waits while the stored leaves cannot be read', async () => {
    await waitsFor(next, 'store', 'waiting for the store')
    expect(joins(next)).toHaveLength(0)
  })

  await step('the page lives on, stops its session and says so; an older report that arrives late does not undo it', async () => {
    await report(next, { seq: 1_000, received: first.attendeeId, ended: { attendeeId: first.attendeeId, reason: 'left' } })
    next.fake.control('stopMedia', { attendeeId: first.attendeeId })
    await report(next, { seq: 999, holds: first.attendeeId, received: first.attendeeId })
  })

  await step('once the store reads, the stored leave goes out, the earlier report clears it, and the join goes', async () => {
    writeStoredLeaves(next.userData, next.fake.teamId, JSON.stringify([recordOf(first)]))
    await waitFor(() => (leftAttendees(next).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the stored leave sent')
    await cleared(next, 'cleared by the report that came before the load')
    expect(valueOf(await starting)._tag).toBe('joined')
    expect(callOrder(next)).toEqual(['rooms.leave', 'rooms.join'])
  })
})

it('keeps a join waiting after a restart while the page may still hold another workspace’s attendee', async () => {
  const engine = await booted()
  const other = join(engine.userData, 'workspaces', 'T0OTHER')
  // The user left workspace T0OTHER mid-call; its attendee's leave is stored there, and the page still runs its media.
  const next = await restarted(engine, () => {
    mkdirSync(other, { recursive: true })
    copyFileSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'), join(other, 'user.db'))
    writeStoredLeaves(engine.userData, 'T0OTHER', JSON.stringify([{ channelId: 'C0OTHER', callId: 'R0OTHER', attendeeId: 'other-attendee', generation: PAGE }]))
  })
  pagesLive(next, PAGE)
  const starting = start(next, 'C0ENG')
  await waitsFor(next, 'lastCall', 'waiting for the other workspace’s attendee')
  expect(joins(next)).toHaveLength(0)
  // The page says it holds no session: the other workspace's attendee is stopped, and the join goes.
  await report(next, {})
  expect(valueOf(await starting)._tag).toBe('joined')
})

/** An inactive workspace's store. */
const broken = (userData: string) => join(userData, 'workspaces', 'T0BROKEN')

/** A Start from the live page joins without waiting, and the call ends again. */
const joinsPromptly = async (next: RunningEngine) => {
  pagesLive(next, PAGE)
  const result = valueOf(await settled(start(next, 'C0ENG'), 'joined'))
  if (result._tag !== 'joined') throw new Error(`start was ${result._tag}`)
  await endCall(next, result.attendeeId)
}

it('a store that cannot be read: an inactive workspace’s is left out, the signed-in workspace’s holds joins back until it reads', async () => {
  let engine = await booted()

  await step('an inactive workspace’s user.db with no prefs table yet, as after a crash before the first migration', async () => {
    engine = await restarted(engine, () => {
      mkdirSync(broken(engine.userData), { recursive: true })
      const db = new DatabaseSync(join(broken(engine.userData), 'user.db'))
      db.exec('CREATE TABLE unrelated (x INTEGER)')
      db.close()
    })
    await joinsPromptly(engine)
  })

  await step('an inactive workspace’s stored leaves that are not JSON', async () => {
    engine = await restarted(engine, () => {
      copyFileSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'), join(broken(engine.userData), 'user.db'))
      writeStoredLeaves(engine.userData, 'T0BROKEN', 'not json {')
    })
    await joinsPromptly(engine)
  })

  await step('the signed-in workspace’s stored null is not an empty list: the join waits until the store reads', async () => {
    engine = await restarted(engine, () => writeStoredLeaves(engine.userData, engine.fake.teamId, 'null'))
    pagesLive(engine, PAGE)
    const starting = start(engine, 'C0ENG')
    await waitsFor(engine, 'store', 'waiting for the store')
    expect(joins(engine)).toHaveLength(0)
    writeStoredLeaves(engine.userData, engine.fake.teamId, '[]')
    expect(valueOf(await starting)._tag).toBe('joined')
  })
})
