// Huddles (SPEC 20, specs/huddle.qnt) through the engine's routes against
// the fake Slack. The renderer's media session is played by the test: it
// reports `huddle.media` as the real one would.
import { afterEach, expect, it } from 'vitest'
import { huddleCall, huddleLeave, huddleMedia, huddleRunning, huddleStart, type HuddleCall, type HuddleMediaEvent, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { sleep, waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, readDb, restart, valueOf } from './scenario'

const track: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of track.splice(0)) await engine.stop()
})

const SELF = 'U0TUSHAR'
const callAtom = liveQuery(huddleCall)(undefined)
const runningAtom = liveQuery(huddleRunning)(undefined)

async function booted(): Promise<RunningEngine> {
  const engine = await bootedEngine(track)
  engine.registry.mount(callAtom)
  engine.registry.mount(runningAtom)
  return engine
}

const callUntil = (engine: RunningEngine, done: (call: HuddleCall) => boolean, label: string) =>
  waitFor(() => {
    const result = engine.registry.get(callAtom)
    return result._tag === 'Success' && done(result.value) ? result.value : undefined
  }, WAIT_MS, label)

const runningUntil = (engine: RunningEngine, done: (running: RunningHuddles) => boolean, label: string) =>
  waitFor(() => {
    const result = engine.registry.get(runningAtom)
    return result._tag === 'Success' && done(result.value) ? result.value : undefined
  }, WAIT_MS, label)

const start = (engine: RunningEngine, channelId: string) => runCommand(engine.registry, huddleStart, { channelId, region: 'us-east-1' })

const joined = async (engine: RunningEngine, channelId: string): Promise<Extract<HuddleStartResult, { _tag: 'joined' }>> => {
  const result = valueOf(await start(engine, channelId))
  if (result._tag !== 'joined') throw new Error(`start in ${channelId} was ${result._tag}`)
  return result
}

const media = async (engine: RunningEngine, event: HuddleMediaEvent) => valueOf(await runCommand(engine.registry, huddleMedia, { event }))

/** Joined with media running, as the renderer would after the hand-off. */
const inCall = async (engine: RunningEngine, channelId: string) => {
  const result = await joined(engine, channelId)
  await media(engine, { _tag: 'started', attendeeId: result.attendeeId })
  await callUntil(engine, (call) => call.phase === 'joined' && call.attendeeId === result.attendeeId, 'joined')
  return result
}

const leaves = (engine: RunningEngine) => apiCalls(engine, 'rooms.leave')
const joins = (engine: RunningEngine) => apiCalls(engine, 'rooms.join')
const leftAttendees = (engine: RunningEngine) => leaves(engine).map((call) => call.args['attendee_id'])

const storedLeaves = (engine: RunningEngine): unknown =>
  readDb(engine, 'user.db', (db) => {
    const row = db.prepare('SELECT value_json FROM prefs WHERE key = ?').get('huddle.pendingLeaves') as { value_json: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.value_json)
  })

type FrameWhere = NonNullable<Parameters<RunningEngine['fake']['holdFramesWhere']>[0]>

const isRoomFrame = (type: string, channel: string): FrameWhere => (frame) =>
  frame.type === 'unknown' && frame.raw['type'] === type && (frame.raw['huddle'] as { channel_id?: string } | undefined)?.channel_id === channel

it('starts a huddle as the official client does, stores the leave before the hand-off, and shows who comes and goes', async () => {
  const engine = await booted()
  const result = await joined(engine, 'C0ENG')
  expect(result.credentials.attendee['AttendeeId']).toBe(result.attendeeId)
  expect(result.credentials.meeting['MeetingId']).toEqual(expect.any(String))
  const [join] = joins(engine)
  expect(join?.args).toMatchObject({ channel_id: 'C0ENG', regions: 'us-east-1', multidevice: 'false', _x_reason: 'calls-api/joinRoom' })
  expect(storedLeaves(engine)).toEqual([{ channelId: 'C0ENG', callId: result.callId, attendeeId: result.attendeeId }])
  // Joining until the media session says it started.
  await callUntil(engine, (call) => call.phase === 'joining' && call.attendeeId === result.attendeeId, 'joining')
  await media(engine, { _tag: 'started', attendeeId: result.attendeeId })
  await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'joined alone')

  engine.fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await callUntil(engine, (call) => call.participants.join() === `${SELF},U0MAYA`, 'Maya joined')
  await runningUntil(engine, (running) => running['C0ENG']?.participants.length === 2, 'two in the running list')
  engine.fake.control('leaveHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left')

  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await waitFor(() => (leaves(engine).length === 1 ? true : undefined), WAIT_MS, 'the leave sent')
  expect(leaves(engine)[0]?.args).toMatchObject({ channel_id: 'C0ENG', call_id: result.callId, attendee_id: result.attendeeId, reason: 'user_initiated', _x_reason: 'calls-api/leaveRoom' })
  // Until the media session says it stopped, the leave stays stored.
  await callUntil(engine, (call) => call.phase === 'leaving' && call.attendeeId === null, 'leaving')
  expect(storedLeaves(engine)).toHaveLength(1)
  await media(engine, { _tag: 'ended', attendeeId: result.attendeeId, reason: 'left' })
  const after = await callUntil(engine, (call) => call.phase === 'idle', 'idle')
  expect(after.ended).toEqual({ channelId: 'C0ENG', reason: 'left' })
  expect(storedLeaves(engine)).toEqual([])
  await runningUntil(engine, (running) => running['C0ENG'] === undefined, 'the huddle ended')
})

it('leaves without waiting for Slack, and takes feature_not_enabled as done', async () => {
  const engine = await booted()
  const result = await inCall(engine, 'C0ENG')
  engine.fake.forceError({ method: 'rooms.leave', error: 'feature_not_enabled' })
  engine.fake.holdNext({ method: 'rooms.leave' })
  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await waitFor(() => (engine.fake.heldCount({ method: 'rooms.leave' }) === 1 ? true : undefined), WAIT_MS, 'the leave out')
  // The media stop is what counts on huddles_arch_v2: the record goes while Slack's answer is still held.
  await media(engine, { _tag: 'ended', attendeeId: result.attendeeId, reason: 'left' })
  await callUntil(engine, (call) => call.phase === 'idle', 'idle with the answer held')
  expect(storedLeaves(engine)).toEqual([])
  engine.fake.release()
  await waitFor(() => (leaves(engine)[0]?.error === 'feature_not_enabled' ? true : undefined), WAIT_MS, 'the answer')
  await sleep(300)
  expect(leaves(engine)).toHaveLength(1)
  expect(joins(engine)).toHaveLength(1)
})

it('switches by leaving first, and joins only once the old session stopped', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  const switching = start(engine, 'C0PRODUCT')
  await callUntil(engine, (call) => call.phase === 'joining' && call.channelId === 'C0PRODUCT' && call.attendeeId === null, 'joining the next')
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the old leave sent')
  await sleep(300)
  expect(joins(engine)).toHaveLength(1)
  await media(engine, { _tag: 'ended', attendeeId: first.attendeeId, reason: 'left' })
  const second = valueOf(await switching)
  if (second._tag !== 'joined') throw new Error('not joined')
  expect(second.channelId).toBe('C0PRODUCT')
  expect(second.attendeeId).not.toBe(first.attendeeId)
  const methods = engine.fake.calls.filter((call) => call.method === 'rooms.join' || call.method === 'rooms.leave').map((call) => call.method)
  expect(methods).toEqual(['rooms.join', 'rooms.leave', 'rooms.join'])
  expect(storedLeaves(engine)).toEqual([{ channelId: 'C0PRODUCT', callId: second.callId, attendeeId: second.attendeeId }])
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
  expect(storedLeaves(engine)).toEqual([])
})

it('after another device took over, ends the call and does not join again on reconnect', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  await media(engine, { _tag: 'ended', attendeeId: first.attendeeId, reason: 'anotherDevice' })
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

it('a late or stale room frame never ends the call or rolls back who is in it', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  // The fake's leave frame for the first room waits until the next call is up.
  engine.fake.holdFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
  const switching = start(engine, 'C0PRODUCT')
  await waitFor(() => (leftAttendees(engine).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the old leave sent')
  await media(engine, { _tag: 'ended', attendeeId: first.attendeeId, reason: 'left' })
  const second = valueOf(await switching)
  if (second._tag !== 'joined') throw new Error('not joined')
  await media(engine, { _tag: 'started', attendeeId: second.attendeeId })
  await callUntil(engine, (call) => call.phase === 'joined' && call.participants.join() === SELF, 'in the second')
  engine.fake.releaseFramesWhere(isRoomFrame('sh_room_leave', 'C0ENG'))
  engine.fake.holdFramesWhere(undefined)

  // While no read can answer, an older frame of this room, then the user's own leave of it from another session.
  engine.fake.holdNext({ method: 'edge:huddles/info', times: 10 })
  const room = { id: second.callId, channels: ['C0PRODUCT'], date_start: Math.floor(engine.fake.now() / 1000) }
  engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, participants: [], has_ended: true }, event_ts: '1.000001' })
  expect((await runningUntil(engine, () => true, 'running'))['C0PLATFORM']).toBeUndefined()
  engine.fake.control('startHuddle', { channel: 'C0PLATFORM', user: 'U0LEO' })
  await runningUntil(engine, (running) => running['C0PLATFORM'] !== undefined, 'a later frame seen')
  let call = await callUntil(engine, () => true, 'call')
  expect(call).toMatchObject({ phase: 'joined', attendeeId: second.attendeeId, participants: [SELF] })

  engine.fake.emitFrame({ type: 'sh_room_leave', user: SELF, huddle: { channel_id: 'C0PRODUCT' }, room: { ...room, participants: ['U0MAYA'] }, event_ts: '9999999999.000001' })
  call = await callUntil(engine, (c) => c.participants.join() === 'U0MAYA', 'the newer frame applied')
  expect(call).toMatchObject({ phase: 'joined', attendeeId: second.attendeeId })
  engine.fake.release()
  await sleep(300)
  expect(leftAttendees(engine)).toEqual([first.attendeeId])
})

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

it('after a crash, sends the stored leave on the next start before any new join', async () => {
  const engine = await booted()
  const first = await inCall(engine, 'C0ENG')
  expect(storedLeaves(engine)).toEqual([{ channelId: 'C0ENG', callId: first.callId, attendeeId: first.attendeeId }])
  // The engine stops while the media session never reports again, as in a crash: the record stays.
  const next = await restart(track, engine)
  next.registry.mount(callAtom)
  expect(storedLeaves(next)).toEqual([{ channelId: 'C0ENG', callId: first.callId, attendeeId: first.attendeeId }])
  await waitFor(() => (leftAttendees(next).includes(first.attendeeId) ? true : undefined), WAIT_MS, 'the stored leave sent again')
  const starting = start(next, 'C0PRODUCT')
  await sleep(300)
  expect(joins(next)).toHaveLength(0)
  // The renderer's media service starts with no session.
  await media(next, { _tag: 'idle' })
  const result = valueOf(await starting)
  expect(result._tag).toBe('joined')
  const methods = next.fake.calls.filter((call) => call.method === 'rooms.join' || call.method === 'rooms.leave').map((call) => call.method)
  expect(methods.indexOf('rooms.leave')).toBeLessThan(methods.indexOf('rooms.join'))
  expect(storedLeaves(next)).toHaveLength(1)
})
