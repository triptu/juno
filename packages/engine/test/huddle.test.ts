// Huddles (SPEC 20, specs/huddle.qnt) through the engine's routes against
// the fake Slack on arch v2, as the owner's workspace runs: the call, its
// leaves and who is in it. Recovery is in huddle-recovery.test.ts.
import { expect, it } from 'vitest'
import { huddleLeave } from '@juno/contract'
import { runCommand } from '@juno/state'
import { sleep, waitFor, WAIT_MS } from './harness'
import { valueOf } from './scenario'
import {
  booted, callOrder, callUntil, inCall, isRoomFrame, joined, joins, leaves, leftAttendees, recordOf, runningUntil, SELF, start, started,
  stopHuddleEnginesAfterEach, stopMedia, storedLeaves,
} from './huddleScenario'

stopHuddleEnginesAfterEach()

const cleared = (engine: Parameters<typeof storedLeaves>[0], label: string) =>
  waitFor(() => ((storedLeaves(engine) as Array<unknown>).length === 0 ? true : undefined), WAIT_MS, label)

it('starts a huddle as the official client does, stores the leave before the hand-off, and shows who comes and goes', async () => {
  const engine = await booted()
  const result = await joined(engine, 'C0ENG')
  expect(result.credentials.attendee['AttendeeId']).toBe(result.attendeeId)
  expect(result.credentials.meeting['MeetingId']).toEqual(expect.any(String))
  expect(joins(engine)[0]?.args).toMatchObject({ channel_id: 'C0ENG', regions: 'us-east-1', multidevice: 'false', _x_reason: 'calls-api/joinRoom' })
  expect(storedLeaves(engine)).toEqual([recordOf(result)])
  // Joining until the page's media session says it started.
  await callUntil(engine, (call) => call.phase === 'joining' && call.attendeeId === result.attendeeId, 'joining')
  await started(engine, result.attendeeId)
  await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'joined alone')

  engine.fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await callUntil(engine, (call) => call.participants.join() === `${SELF},U0MAYA`, 'Maya joined')
  await runningUntil(engine, (running) => running['C0ENG']?.participants.length === 2, 'two in the running list')
  engine.fake.control('leaveHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left')

  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await waitFor(() => (leaves(engine)[0]?.error === 'feature_not_enabled' ? true : undefined), WAIT_MS, 'the leave answered')
  expect(leaves(engine)[0]?.args).toMatchObject({ channel_id: 'C0ENG', call_id: result.callId, attendee_id: result.attendeeId, reason: 'user_initiated', _x_reason: 'calls-api/leaveRoom' })
  // Until the page says its media stopped, the leave stays stored.
  await callUntil(engine, (call) => call.phase === 'leaving' && call.attendeeId === null, 'leaving')
  expect(storedLeaves(engine)).toHaveLength(1)
  await stopMedia(engine, result.attendeeId)
  const after = await callUntil(engine, (call) => call.phase === 'idle', 'idle')
  expect(after.ended).toEqual({ channelId: 'C0ENG', reason: 'left' })
  await cleared(engine, 'the record cleared')
  // On arch v2 the media stop is the leave that counts: Slack drops the user, then the empty huddle.
  await runningUntil(engine, (running) => running['C0ENG'] === undefined, 'the huddle ended')
})

it('clears a leave once it went out without waiting for the answer, and sends a refused one again', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  engine.fake.holdNext({ method: 'rooms.leave' })
  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.leave' }) === 1 ? true : undefined), WAIT_MS, 'the leave out')
  await stopMedia(engine, first.attendeeId)
  await cleared(engine, 'cleared with the answer held')
  engine.fake.release()

  // Slack refuses the next leave with a rate limit after the record was cleared: it is stored and sent again.
  const second = await inCall(engine, 'C0ENG')
  engine.fake.force429({ method: 'rooms.leave', retryAfter: 1, times: 1 })
  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await stopMedia(engine, second.attendeeId)
  await waitFor(() => (leftAttendees(engine).filter((id) => id === second.attendeeId).length === 2 ? true : undefined), WAIT_MS, 'sent again')
  expect(leaves(engine).filter((call) => call.args['attendee_id'] === second.attendeeId).map((call) => call.status)).toEqual([429, 200])
  await cleared(engine, 'cleared after the second send')
})

it('switches by leaving first, and joins only once the old session stopped', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  const switching = start(engine, 'C0PRODUCT')
  await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0PRODUCT' && call.attendeeId === null, 'joining the next')
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the old leave sent')
  await sleep(300)
  expect(joins(engine)).toHaveLength(1)
  await stopMedia(engine, first.attendeeId)
  const second = valueOf(await switching)
  if (second._tag !== 'joined') throw new Error('not joined')
  expect(second.channelId).toBe('C0PRODUCT')
  expect(second.attendeeId).not.toBe(first.attendeeId)
  expect(callOrder(engine)).toEqual(['rooms.join', 'rooms.leave', 'rooms.join'])
  expect(storedLeaves(engine)).toEqual([recordOf(second)])
})

it('cleans up the attendee of a join left before Slack answered, and never hands it out', async () => {
  const engine = await booted()
  engine.fake.holdNext({ method: 'rooms.join' })
  const starting = start(engine, 'C0ENG')
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.join' }) === 1 ? true : undefined), WAIT_MS, 'the join out')
  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  expect(valueOf(await starting)).toEqual({ _tag: 'cancelled' })
  engine.fake.release()
  await waitFor(() => (leaves(engine).length === 1 ? true : undefined), WAIT_MS, 'the returned attendee left')
  await callUntil(engine, (call) => call.phase === 'idle' && call.attendeeId === null, 'idle')
  await cleared(engine, 'cleared: no page held it')
})

it('after another device took over, ends the call, and ignores reports from other pages', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // Another page's report about this attendee changes nothing.
  await stopMedia(engine, first.attendeeId, 'anotherDevice', 'page-0')
  expect((await callUntil(engine, () => true, 'call')).phase).toBe('joined')
  await stopMedia(engine, first.attendeeId, 'anotherDevice')
  const call = await callUntil(engine, (c) => c.phase === 'idle', 'idle')
  expect(call).toMatchObject({ attendeeId: null, ended: { channelId: 'C0ENG', reason: 'anotherDevice' } })
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the leave sent')
  const reads = engine.fake.calls.filter((c) => c.method === 'huddles/info').length
  engine.fake.dropSocket()
  await waitFor(() => (engine.fake.calls.filter((c) => c.method === 'huddles/info').length > reads ? true : undefined), WAIT_MS, 'the read after reconnect')
  await sleep(300)
  expect(joins(engine)).toHaveLength(1)
  expect((await callUntil(engine, () => true, 'call')).phase).toBe('idle')
  // Only a new Start joins again.
  expect((await joined(engine, 'C0ENG')).attendeeId).not.toBe(first.attendeeId)
})

it('a late frame or a frame about another room never ends the call or rolls back who is in it', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // The leave frame of the first room waits until the next call is up.
  engine.fake.holdFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
  const switching = start(engine, 'C0PRODUCT')
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the old leave sent')
  await stopMedia(engine, first.attendeeId)
  const second = valueOf(await switching)
  if (second._tag !== 'joined') throw new Error('not joined')
  await started(engine, second.attendeeId)
  await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'in the second')
  await sleep(300)
  engine.fake.releaseFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
  engine.fake.holdFramesWhere(undefined)

  // While no read can answer: an older frame of this room, and one about another room in this channel.
  engine.fake.holdNext({ method: 'edge:huddles/info', times: 10 })
  const room = { id: second.callId, channels: ['C0PRODUCT'], date_start: Math.floor(engine.fake.now() / 1000) }
  engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, participants: [], has_ended: true }, event_ts: '1.000001' })
  engine.fake.emitFrame({ type: 'sh_room_update', huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, id: 'R999999999', participants: ['U0LEO'] }, event_ts: '9999999998.000001' })
  engine.fake.control('startHuddle', { channel: 'C0PLATFORM', user: 'U0LEO' })
  await runningUntil(engine, (running) => running['C0PLATFORM'] !== undefined, 'a later frame seen')
  let call = await callUntil(engine, () => true, 'call')
  expect(call).toMatchObject({ phase: 'joined', attendeeId: second.attendeeId, participants: [SELF] })

  // A newer frame of this room is merged, even the user's own leave from elsewhere; the call stays.
  engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, participants: ['U0MAYA'] }, event_ts: '9999999999.000001' })
  call = await callUntil(engine, (c) => c.participants.join() === 'U0MAYA', 'the newer frame applied')
  expect(call).toMatchObject({ phase: 'joined', attendeeId: second.attendeeId })
  engine.fake.release()
  await sleep(300)
  expect(leftAttendees(engine)).toEqual([first.attendeeId])
})
