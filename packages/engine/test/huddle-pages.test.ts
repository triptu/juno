// Huddle media across the lifetimes of the renderer page and the engine
// (specs/huddle.qnt): the page reports its whole state, main reports which
// pages live, and the engine computes from both whether media may run.
import { expect, it } from 'vitest'
import { sleep, waitFor, WAIT_MS } from './harness'
import { restart, valueOf } from './scenario'
import {
  booted, callUntil, inCall, joined, joins, leftAttendees, PAGE, pagesLive, recordOf, report, start, stopHuddleEnginesAfterEach, storedLeaves, track, watchHuddles,
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
  pagesLive(engine, 'page-2')
  await sleep(200)
  engine.fake.release()
  expect(valueOf(await starting)).toEqual({ _tag: 'cancelled' })
  await waitFor(() => (leftAttendees(engine).length === 1 ? true : undefined), WAIT_MS, 'the attendee left')
  await cleared(engine, 'cleared: no page ever had its media')
  expect((await callUntil(engine, () => true, 'call')).attendeeId).toBeNull()
  // Nothing waits on the dead page: the new page joins.
  expect((await joined(engine, 'C0ENG', 'page-2'))._tag).toBe('joined')
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
  const starting = start(engine, 'C0ENG', 'page-2')
  await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0ENG', 'joining')
  await sleep(500)
  expect(joins(engine)).toHaveLength(0)
  pagesLive(engine, PAGE, 'page-2')
  const result = valueOf(await starting)
  expect(result._tag).toBe('joined')
})
