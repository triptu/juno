// Huddle media across the lifetimes of the renderer page and the engine
// (specs/huddle.qnt): the page reports its whole state, main reports which
// pages live, and the engine computes from both whether media may run.
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'bun:test'
import { huddleStart } from '@juno/contract'
import { runCommand } from '@juno/state'
import { sleep, waitFor, WAIT_MS } from './harness'
import { restart, valueOf } from './scenario'
import {
  booted, callUntil, inCall, joined, joins, leftAttendees, PAGE, PAGE2, pagesLive, pagesReport, recordOf, report, start, stopHuddleEnginesAfterEach, storedLeaves, track, watchHuddles,
  writeStoredLeaves,
} from './huddleScenario'

stopHuddleEnginesAfterEach()

const cleared = (engine: Parameters<typeof storedLeaves>[0], label: string) =>
  waitFor(() => ((storedLeaves(engine) as Array<unknown> | undefined)?.length === 0 ? true : undefined), WAIT_MS, label)

it('leaves at once a join answered after its page died, and hands it to no page', async () => {
  const engine = await booted()
  engine.fake.holdNext({ method: 'rooms.join' })
  const starting = start(engine, 'C0ENG')
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  // The page crashes while Slack has the join; a new page loads.
  pagesLive(engine, PAGE2)
  await sleep(200)
  engine.fake.release()
  expect(valueOf(await starting)).toEqual({ _tag: 'cancelled' })
  await waitFor(() => (leftAttendees(engine).length === 1 ? true : undefined), WAIT_MS, 'the attendee left')
  await cleared(engine, 'cleared: no page ever had its media')
  expect((await callUntil(engine, () => true, 'call')).attendeeId).toBeNull()
  // Nothing waits on the dead page: the new page joins.
  expect((await joined(engine, 'C0ENG', PAGE2))._tag).toBe('joined')
})

it('counts a page report sent before the stored leaves loaded, after an engine restart', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  const stored = JSON.stringify([recordOf(first)])
  // The restarted engine cannot read its store at first, so the page reports before the load.
  const next = watchHuddles(await restart(track, engine, () => writeStoredLeaves(engine.userData, engine.fake.teamId, 'not json {')))
  pagesLive(next, PAGE)
  // The page lives on: it sees no call, stops its session, and says so when it connects to the new engine.
  await report(next, { seq: 1_000, received: first.attendeeId, ended: { attendeeId: first.attendeeId, reason: 'left' } })
  next.fake.control('stopMedia', { attendeeId: first.attendeeId })
  // An older report, from before the stop, arrives late: it does not undo the newer one.
  await report(next, { seq: 999, holds: first.attendeeId, received: first.attendeeId })
  writeStoredLeaves(next.userData, next.fake.teamId, stored)
  await waitFor(() => (leftAttendees(next).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the stored leave sent')
  await cleared(next, 'cleared by the report that came before the load')
  expect((await joined(next, 'C0PRODUCT'))._tag).toBe('joined')
})

it('lets a Start overtake main’s report of its new page: it waits for the page to be listed', async () => {
  const engine = await booted()
  const starting = start(engine, 'C0ENG', PAGE2)
  await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0ENG', 'joining')
  await sleep(500)
  expect(joins(engine)).toHaveLength(0)
  pagesLive(engine, PAGE, PAGE2)
  const result = valueOf(await starting)
  expect(result._tag).toBe('joined')
})

it('cleans up a join whose Start connection closed before Slack answered, and joins again', async () => {
  const engine = await booted()
  // The page asks on one engine connection, which closes while Slack has the join; the same page reconnects.
  const asking = engine.openWindow()
  engine.fake.holdNext({ method: 'rooms.join' })
  void runCommand(asking, huddleStart, { channelId: 'C0ENG', region: 'us-east-1', generation: PAGE }).catch(() => undefined)
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  asking.dispose()
  const reconnected = engine.openWindow()
  await sleep(300)
  engine.fake.release()
  // On its new connection the page says it holds nothing: it never got the credentials.
  await report(engine, {}, reconnected)
  await waitFor(() => (leftAttendees(engine).length === 1 ? true : undefined), WAIT_MS, 'the attendee left')
  await cleared(engine, 'cleared: no page has its media')
  expect((await joined(engine, 'C0ENG'))._tag).toBe('joined')
})

it('keeps a join waiting after a restart while the page may still hold another workspace’s attendee', async () => {
  const engine = await booted()
  const other = join(engine.userData, 'workspaces', 'T0OTHER')
  // The user left workspace T0OTHER mid-call; its attendee's leave is stored there, and the page still runs its media.
  const next = watchHuddles(await restart(track, engine, () => {
    mkdirSync(other, { recursive: true })
    copyFileSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'), join(other, 'user.db'))
    writeStoredLeaves(engine.userData, 'T0OTHER', JSON.stringify([{ channelId: 'C0OTHER', callId: 'R0OTHER', attendeeId: 'other-attendee', generation: PAGE }]))
  }))
  pagesLive(next, PAGE)
  const starting = start(next, 'C0ENG')
  await callUntil(next, (call) => call.phase === 'joining', 'joining')
  await sleep(1_000)
  expect(joins(next)).toHaveLength(0)
  // The page says it holds no session: the other workspace's attendee is stopped, and the join goes.
  await report(next, {})
  expect(valueOf(await starting)._tag).toBe('joined')
})

it('drops a Start from a page that died before main listed it', async () => {
  const engine = await booted()
  const starting = start(engine, 'C0ENG', PAGE2)
  await callUntil(engine, (call) => call.phase === 'joining', 'joining')
  // Main gave out PAGE2, which died unlisted; it lists the page after it.
  pagesReport(engine, [PAGE2 + 1], PAGE2 + 1)
  const outcome = await Promise.race([starting.then(valueOf), sleep(5_000).then(() => 'still waiting' as const)])
  expect(outcome).toEqual({ _tag: 'cancelled' })
  expect(joins(engine)).toHaveLength(0)
})

/** Restarts with an inactive workspace `T0BROKEN` whose user.db `prepare` leaves as it likes. */
const restartWithBroken = async (prepare: (dir: string, source: string) => void) => {
  const engine = await booted()
  const dir = join(engine.userData, 'workspaces', 'T0BROKEN')
  return watchHuddles(await restart(track, engine, () => {
    mkdirSync(dir, { recursive: true })
    prepare(dir, join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'))
  }))
}

const joinsPromptly = async (next: Awaited<ReturnType<typeof restartWithBroken>>) => {
  pagesLive(next, PAGE)
  const outcome = await Promise.race([start(next, 'C0ENG').then(valueOf), sleep(10_000).then(() => 'still waiting' as const)])
  expect(outcome).toMatchObject({ _tag: 'joined' })
}

it('joins when an inactive workspace’s user.db has no prefs table yet', async () => {
  const next = await restartWithBroken((dir) => {
    // As after a crash before the first migration.
    const db = new DatabaseSync(join(dir, 'user.db'))
    db.exec('CREATE TABLE unrelated (x INTEGER)')
    db.close()
  })
  await joinsPromptly(next)
})

it('joins when an inactive workspace’s stored leaves are unreadable, leaving that workspace out', async () => {
  const next = await restartWithBroken((dir, source) => {
    copyFileSync(source, join(dir, 'user.db'))
    writeStoredLeaves(join(dir, '..', '..'), 'T0BROKEN', 'not json {')
  })
  await joinsPromptly(next)
})
