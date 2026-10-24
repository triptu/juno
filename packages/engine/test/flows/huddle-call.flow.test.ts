// Huddles (SPEC 20, specs/huddle.qnt, specs/huddle-room.qnt) through the engine's routes against the fake Slack on
// arch v2, as the owner's workspace runs: the call, its leaves, who is in it, the status, the alone rule, and the
// races between a join and the page or Start that asked for it. A join that waits shows why in `huddle.call`
// (`waitingFor`), so "no join yet" is read from the engine's own decision, not after a pause. Restarts, crashes and
// socket gaps are in huddle-recovery.flow.test.ts.
import { expect, it } from 'bun:test'
import { huddleStart, type HuddleCall } from '@juno/contract'
import { runCommand } from '@juno/state'
import { controlledSleep } from '../controlledClock'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import {
  callOrder, callUntil, cleared, huddleScenario, isRoomFrame, joined, joins, leave, leaves, leftAttendees, PAGE, PAGE2, pagesLive, pagesReport, recordOf,
  runningUntil, SELF, settled, start, storedLeaves,
} from '../huddleScenario'
import { apiCalls, valueOf } from '../scenario'
import { step } from '../step'

const { booted, endCall, inCall, report, started, stopMedia } = huddleScenario()

const statusWrites = (engine: RunningEngine) => apiCalls(engine, 'users.profile.set')
/** The expiry a status write set, in epoch milliseconds. */
const expiryOf = (write: ReturnType<typeof statusWrites>[number]) => {
  const profile = JSON.parse(write.args['profile'] ?? '{}') as Record<string, number>
  expect(Object.keys(profile)).toEqual(['huddle_state_expiration_ts'])
  return Math.round(profile['huddle_state_expiration_ts']! * 1000)
}
const EXPIRY_MS = 300_000

it('a call: Start stores the leave before the hand-off, the status is kept only while live, people come and go, and a leave goes out at once and clears once out', async () => {
  const engine = await booted({ timing: { huddleStatusRenewMillis: 100 } })
  const result = await joined(engine, 'C0ENG')
  let liveFrom = 0

  await step('Start joins as the official client does, and the leave is stored before the credentials are handed over', async () => {
    expect(result.credentials.attendee['AttendeeId']).toBe(result.attendeeId)
    expect(result.credentials.meeting['MeetingId']).toEqual(expect.any(String))
    expect(joins(engine)[0]?.args).toMatchObject({ channel_id: 'C0ENG', regions: 'us-east-1', multidevice: 'false', _x_reason: 'calls-api/joinRoom' })
    expect(storedLeaves(engine)).toEqual([recordOf(result)])
  })

  await step('joining until the page says its media started; only then is the "In a huddle" status set and renewed', async () => {
    await callUntil(engine, (call) => call.phase === 'joining' && call.attendeeId === result.attendeeId && call.waitingFor === null, 'joining')
    liveFrom = Date.now()
    await started(engine, result.attendeeId)
    await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'joined alone')
    await waitFor(() => (statusWrites(engine).length >= 3 ? true : undefined), WAIT_MS, 'the status set and renewed')
    const [first] = statusWrites(engine)
    expect(first?.args['_x_reason']).toBe('increment-huddle-state-expiration-ts')
    // Now plus 300 s, as the official client writes it, from when the media started: a write made while joining would be older.
    expect(expiryOf(first!)).toBeGreaterThanOrEqual(liveFrom + EXPIRY_MS)
    expect(expiryOf(first!)).toBeLessThanOrEqual(Date.now() + EXPIRY_MS)
    expect(Math.round(Number(engine.fake.control('huddleStatus', {})) * 1000)).toBe(expiryOf(statusWrites(engine).at(-1)!))
  })

  await step('Maya joins and leaves, in the call and in the running list', async () => {
    engine.fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
    await callUntil(engine, (call) => call.participants.join() === `${SELF},U0MAYA`, 'Maya joined')
    await runningUntil(engine, (running) => running['C0ENG']?.participants.length === 2, 'two in the running list')
    engine.fake.control('leaveHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
    await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left')
  })

  await step('Leave sends rooms.leave at once; the leave stays stored until the page says its media stopped', async () => {
    await leave(engine)
    await waitFor(() => (leaves(engine)[0]?.error === 'feature_not_enabled' ? true : undefined), WAIT_MS, 'the leave answered')
    expect(leaves(engine)[0]?.args).toMatchObject({ channel_id: 'C0ENG', call_id: result.callId, attendee_id: result.attendeeId, reason: 'user_initiated', _x_reason: 'calls-api/leaveRoom' })
    await callUntil(engine, (call) => call.phase === 'leaving' && call.attendeeId === null, 'leaving')
    expect(storedLeaves(engine)).toHaveLength(1)
    await stopMedia(engine, result.attendeeId)
    expect(await callUntil(engine, (call) => call.phase === 'idle', 'idle')).toMatchObject({ ended: { channelId: 'C0ENG', reason: 'left' } })
    await cleared(engine, 'the record cleared')
    // On arch v2 the media stop is the leave that counts: Slack drops the user, then the empty huddle.
    await runningUntil(engine, (running) => running['C0ENG'] === undefined, 'the huddle ended')
  })

  await step('a leave clears once it went out, without waiting for its answer', async () => {
    const next = await inCall(engine, 'C0ENG')
    engine.fake.holdNext({ method: 'rooms.leave' })
    await leave(engine)
    await waitFor(() => (engine.fake.heldCount({ method: 'rooms.leave' }) === 1 ? true : undefined), WAIT_MS, 'the leave out')
    await stopMedia(engine, next.attendeeId)
    await cleared(engine, 'cleared with the answer held')
    engine.fake.release()
  })

  await step('a leave Slack refused with a rate limit after the record was cleared is stored and sent a second later; the status stopped with the call', async () => {
    const next = await inCall(engine, 'C0ENG')
    engine.fake.force429({ method: 'rooms.leave', retryAfter: 1, times: 1 })
    const leftAt = Date.now()
    await leave(engine)
    await stopMedia(engine, next.attendeeId)
    await waitFor(() => (leftAttendees(engine).filter((id) => id === next.attendeeId).length === 2 ? true : undefined), WAIT_MS, 'sent again')
    expect(leaves(engine).filter((call) => call.args['attendee_id'] === next.attendeeId).map((call) => call.status)).toEqual([429, 200])
    await cleared(engine, 'cleared after the second send')
    // The second send waited on a one-second engine timer, the renewal on 100 ms ones: a renewal after the leave
    // would be here by now. None came, and no clearing write either, so the status lapses at its expiry.
    for (const write of statusWrites(engine)) {
      expect(expiryOf(write)).toBeGreaterThanOrEqual(liveFrom + EXPIRY_MS)
      expect(expiryOf(write)).toBeLessThanOrEqual(leftAt + EXPIRY_MS)
    }
  })
})

it('switches by leaving first and joins once the old media stopped; a late or unrelated room frame never ends the call or rolls back who is in it', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // The first room's leave frame waits until the next call is up.
  engine.fake.holdFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
  const switching = start(engine, 'C0PRODUCT')
  let second: Awaited<ReturnType<typeof joined>> | undefined

  await step('the next join waits for the old session to stop (specs/huddle.qnt requestJoin)', async () => {
    await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the old leave sent')
    await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0PRODUCT' && call.attendeeId === null && call.waitingFor === 'lastCall', 'waiting for the old session')
    expect(joins(engine)).toHaveLength(1)
    await stopMedia(engine, first.attendeeId)
    const result = valueOf(await switching)
    if (result._tag !== 'joined') throw new Error('not joined')
    second = result
    expect(second.channelId).toBe('C0PRODUCT')
    expect(second.attendeeId).not.toBe(first.attendeeId)
    expect(callOrder(engine)).toEqual(['rooms.join', 'rooms.leave', 'rooms.join'])
    expect(storedLeaves(engine)).toEqual([recordOf(second)])
    await started(engine, second.attendeeId)
    await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'in the second')
  })

  await step('the old room\'s late leave frame, an older frame of this room and one about another room change nothing', async () => {
    engine.fake.releaseFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
    engine.fake.holdFramesWhere(undefined)
    // While no read can answer.
    engine.fake.holdNext({ method: 'edge:huddles/info', times: 10 })
    const room = { id: second!.callId, channels: ['C0PRODUCT'], date_start: Math.floor(engine.fake.now() / 1000) }
    engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, participants: [], has_ended: true }, event_ts: '1.000001' })
    engine.fake.emitFrame({ type: 'sh_room_update', huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, id: 'R999999999', participants: ['U0LEO'] }, event_ts: '9999999998.000001' })
    // Frames apply in order: once this later one shows, the ones above were applied.
    engine.fake.control('startHuddle', { channel: 'C0PLATFORM', user: 'U0LEO' })
    await runningUntil(engine, (running) => running['C0PLATFORM'] !== undefined, 'a later frame seen')
    expect(await callUntil(engine, () => true, 'call')).toMatchObject({ phase: 'joined', attendeeId: second!.attendeeId, participants: [SELF] })
  })

  await step('a newer frame of this room applies, even the user\'s own leave from elsewhere; the call stays', async () => {
    engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { id: second!.callId, channels: ['C0PRODUCT'], date_start: Math.floor(engine.fake.now() / 1000), participants: ['U0MAYA'] }, event_ts: '9999999999.000001' })
    const call = await callUntil(engine, (c) => c.participants.join() === 'U0MAYA', 'the newer frame applied')
    expect(call).toMatchObject({ phase: 'joined', attendeeId: second!.attendeeId })
  })

  await step('the held reads answer with the room as Slack lists it, and nothing else is left', async () => {
    engine.fake.release()
    const call = await callUntil(engine, (c) => c.participants.join() === SELF, 'a read of this room applied')
    expect(call).toMatchObject({ phase: 'joined', attendeeId: second!.attendeeId })
    expect(leftAttendees(engine)).toEqual([first.attendeeId])
  })
})

it('a join answered after its Start went is left at once and handed to no page: after a Leave, a closed connection, or a dead page', async () => {
  const engine = await booted()
  // Each step's join going out also shows that the step before left nothing waiting.
  const joinOut = async () => {
    await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  }

  await step('Leave before Slack answered: the Start is cancelled, and the attendee Slack returns is left', async () => {
    engine.fake.holdNext({ method: 'rooms.join' })
    const starting = start(engine, 'C0ENG')
    await joinOut()
    await leave(engine)
    expect(valueOf(await starting)).toEqual({ _tag: 'cancelled' })
    engine.fake.release()
    await waitFor(() => (leaves(engine).length === 1 ? true : undefined), WAIT_MS, 'the returned attendee left')
    await callUntil(engine, (call) => call.phase === 'idle' && call.attendeeId === null, 'idle')
    await cleared(engine, 'cleared: no page held it')
  })

  await step('the Start\'s connection closed while Slack had the join (specs/huddle.qnt cancelStart): the page, reconnected, holds nothing, and the attendee is left', async () => {
    // The page asks on one engine connection, which closes; the same page reconnects. Whichever reaches the engine
    // first, the close or the answer, the page never ran that media and says so on its new connection.
    const asking = engine.openWindow()
    engine.fake.holdNext({ method: 'rooms.join' })
    void runCommand(asking, huddleStart, { channelId: 'C0ENG', region: 'us-east-1', generation: PAGE }).catch(() => undefined)
    await joinOut()
    asking.dispose()
    const reconnected = engine.openWindow()
    engine.fake.release()
    await report(engine, {}, reconnected)
    await waitFor(() => (leaves(engine).length === 2 ? true : undefined), WAIT_MS, 'the attendee left')
    await cleared(engine, 'cleared: no page has its media')
  })

  await step('the page died while Slack had the join (specs/huddle.qnt bug 8): the Start is cancelled at once, the answer is left, and the new page joins', async () => {
    engine.fake.holdNext({ method: 'rooms.join' })
    const starting = start(engine, 'C0ENG')
    await joinOut()
    pagesLive(engine, PAGE2)
    expect(valueOf(await starting)).toEqual({ _tag: 'cancelled' })
    engine.fake.release()
    await waitFor(() => (leaves(engine).length === 3 ? true : undefined), WAIT_MS, 'the attendee left')
    await cleared(engine, 'cleared: no page ever had its media')
    expect((await callUntil(engine, () => true, 'call')).attendeeId).toBeNull()
    expect((await joined(engine, 'C0ENG', PAGE2))._tag).toBe('joined')
  })
})

it('a Start from a page main has not listed waits for it, and is dropped if that page died unlisted (specs/huddle.qnt gone, rule 12)', async () => {
  const engine = await booted()
  const DIED = PAGE + 1
  const NEXT = PAGE + 2
  const LATER = PAGE + 3

  await step('a Start from a page that died before main listed it is dropped', async () => {
    const starting = start(engine, 'C0ENG', DIED)
    await callUntil(engine, (call) => call.phase === 'joining' && call.waitingFor === 'page', 'waiting for the page')
    // Main gave out DIED, which died unlisted; it lists the page after it.
    pagesReport(engine, [NEXT], NEXT)
    expect(valueOf(await settled(starting, 'the Start answered'))).toEqual({ _tag: 'cancelled' })
    expect(joins(engine)).toHaveLength(0)
  })

  await step('a Start that overtakes main\'s report of its page waits for the page to be listed, then joins', async () => {
    const starting = start(engine, 'C0ENG', LATER)
    await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0ENG' && call.waitingFor === 'page', 'waiting for the page')
    expect(joins(engine)).toHaveLength(0)
    pagesLive(engine, NEXT, LATER)
    expect(valueOf(await starting)._tag).toBe('joined')
  })
})

it('after another device took over, the call ends, reports from other pages change nothing, and only a new Start joins again', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')

  await step('a report from another page about this attendee changes nothing', async () => {
    await stopMedia(engine, first.attendeeId, 'anotherDevice', PAGE - 1)
    // The page's next report is published after it.
    await report(engine, { holds: first.attendeeId, received: first.attendeeId, muted: true })
    expect(await callUntil(engine, (call) => call.muted, 'muted')).toMatchObject({ phase: 'joined', attendeeId: first.attendeeId, ended: null })
  })

  await step('the page says another device took over: the call ends and its leave goes out', async () => {
    await stopMedia(engine, first.attendeeId, 'anotherDevice')
    const call = await callUntil(engine, (c) => c.phase === 'idle', 'idle')
    expect(call).toMatchObject({ attendeeId: null, ended: { channelId: 'C0ENG', reason: 'anotherDevice' } })
    await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the leave sent')
  })

  await step('a reconnect reads running huddles but does not join; a new Start does', async () => {
    const reads = engine.fake.calls.filter((c) => c.method === 'huddles/info').length
    engine.fake.dropSocket()
    await waitFor(() => (engine.fake.calls.filter((c) => c.method === 'huddles/info').length > reads ? true : undefined), WAIT_MS, 'the read after reconnect')
    expect((await callUntil(engine, () => true, 'call')).phase).toBe('idle')
    const again = await joined(engine, 'C0ENG')
    expect(again.attendeeId).not.toBe(first.attendeeId)
    // Joins go one at a time, so any join before this one was answered first: there was none.
    expect(joins(engine)).toHaveLength(2)
  })
})

it('leaves a call the user has been alone in for the alone time, counting again when someone joins, never while the media hears someone', async () => {
  // Only the alone timer runs on this duration; the test moves it.
  const ALONE = 4_321
  const time = await controlledSleep(ALONE)
  try {
    const engine = await booted({ clock: time.clock, timing: { huddleAloneMillis: ALONE } })
    const result = await inCall(engine, 'C0ENG')
    // Alone from here: the count runs.
    await callUntil(engine, (call) => call.participants.join() === SELF, 'alone')
    const stillIn = (call: HuddleCall) => expect(call).toMatchObject({ phase: 'joined', attendeeId: result.attendeeId, ended: null })

    await step('someone joining stops the count, and it starts again when they leave', async () => {
      engine.fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
      await callUntil(engine, (call) => call.participants.join() === `${SELF},U0MAYA`, 'Maya joined')
      await time.advance(ALONE)
      engine.fake.control('leaveHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
      stillIn(await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left'))
    })

    await step('someone the media hears but the room roster lacks stops the count (specs/huddle-room.qnt)', async () => {
      await report(engine, { holds: result.attendeeId, received: result.attendeeId, hasRemote: true })
      await time.advance(ALONE)
      await report(engine, { holds: result.attendeeId, received: result.attendeeId, hasRemote: false, muted: true })
      stillIn(await callUntil(engine, (call) => call.muted, 'muted'))
    })

    await step('alone for the whole time: Juno leaves, and the call ends as alone', async () => {
      const leaving = await waitFor(async () => {
        await time.advance(ALONE)
        const call = await callUntil(engine, () => true, 'call')
        return call.attendeeId === null ? call : undefined
      }, WAIT_MS, 'left alone')
      expect(leaving.ended).toEqual({ channelId: 'C0ENG', reason: 'alone' })
      await waitFor(() => (leftAttendees(engine).includes(result.attendeeId) ? true : undefined), WAIT_MS, 'the leave sent')
      await stopMedia(engine, result.attendeeId)
      expect(await callUntil(engine, (call) => call.phase === 'idle', 'idle')).toMatchObject({ ended: { channelId: 'C0ENG', reason: 'alone' } })
    })
  } finally {
    await time.close()
  }
})

it('keeps an unlisted DM call under a lagging edge, follows who leaves, ends on media termination, and starts a fresh room on rejoin (specs/huddle-room.qnt)', async () => {
  const engine = await booted({ timing: { huddleInfoSettleMillis: 300 } })
  engine.fake.control('setHuddleInfoLag', { ms: 60_000 })
  const first = await inCall(engine, 'D0MAYA')
  engine.fake.control('joinHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  const before = await callUntil(engine, (call) => call.participants.length === 2, 'both joined')

  await step('the edge stops listing the call; the call keeps its room', async () => {
    await runningUntil(engine, (running) => running['D0MAYA'] === undefined, 'the lagging edge removed the listing')
    expect(await callUntil(engine, () => true, 'retained room')).toMatchObject({ phase: 'joined', participants: [SELF, 'U0MAYA'], startedAt: before.startedAt, joinedAt: before.joinedAt })
  })

  await step('Maya leaves the retained room, the room ends before the media, and the media ending ends the call', async () => {
    engine.fake.control('leaveHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
    await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left the retained room')
    engine.fake.control('endHuddle', { channel: 'D0MAYA' })
    await callUntil(engine, (call) => call.participants.length === 0 && call.phase === 'joined', 'room ended before media')
    await stopMedia(engine, first.attendeeId, 'ended')
    expect(await callUntil(engine, (call) => call.phase === 'idle', 'media ended')).toMatchObject({ joinedAt: null, ended: { reason: 'ended' } })
  })

  await step('joining again starts a fresh room', async () => {
    const second = await inCall(engine, 'D0MAYA')
    expect(second.callId).not.toBe(first.callId)
    const rejoined = await callUntil(engine, (call) => call.participants.join() === SELF, 'new room')
    expect(rejoined.joinedAt).toBeGreaterThan(before.joinedAt ?? 0)
    await endCall(engine, second.attendeeId)
  })
})

it('a full read that was asked before a channel\'s first frame does not erase that channel (specs/huddle.qnt discardInfo)', async () => {
  const engine = await booted({ timing: { huddleInfoSettleMillis: 1_000 } })
  const infoReads = () => engine.fake.calls.filter((call) => call.kind === 'edge' && call.method === 'huddles/info').length
  const held = (label: string) => waitFor(() => (engine.fake.heldCount({ method: 'edge:huddles/info' }) === 1 ? true : undefined), WAIT_MS, label)
  await waitFor(() => (infoReads() > 0 ? true : undefined), WAIT_MS, 'the full read after boot')
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  const reconnected = engine.nextSync()
  engine.fake.dropSocket()
  await reconnected
  await held('the full read after the reconnect, held')
  engine.fake.workspace.addConversation({ id: 'C0NEWROOM', name: 'new-room', kind: 'public', members: new Set([SELF, 'U0MAYA']), created: engine.fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
  engine.fake.control('startHuddle', { channel: 'C0NEWROOM', user: 'U0MAYA' })
  await runningUntil(engine, (running) => running['C0NEWROOM'] !== undefined, 'the new room\'s frame')
  // The full answer, from before the room, is applied; the read that repairs the channel is held too, so only the
  // frame can keep it. Reads go one at a time: once the next is out, the full answer was applied.
  engine.fake.release()
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  await held('the repairing read, held')
  // A frame published after that answer.
  engine.fake.control('startHuddle', { channel: 'C0PLATFORM', user: 'U0LEO' })
  const running = await runningUntil(engine, (r) => r['C0PLATFORM'] !== undefined, 'a later frame seen')
  expect(running['C0NEWROOM']).toBeDefined()
  engine.fake.release()
})
