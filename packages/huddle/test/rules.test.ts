// The pure rules of @juno/huddle: room frame decoding and merging, and when
// the alone timer counts. The call's lifecycle (specs/huddle.qnt) is tested
// through the service here (cancel, overflow, workspace-barrier) and against
// the fake Slack in engine/test/flows/huddle-*.flow.test.ts.
import { describe, expect, it } from 'bun:test'
import { aloneNow, leaveAt } from '../src/alone'
import { applyInfo, applyRoomFrame, decodeRoomFrame, type Running } from '../src/running'

const room = (over: Record<string, unknown> = {}) => ({
  type: 'sh_room_join',
  user: 'U0MAYA',
  huddle: { channel_id: 'C1' },
  room: { id: 'R2', channels: ['C1'], participants: ['U0ME', 'U0MAYA'], date_start: 1_790_000_000, has_ended: false },
  event_ts: '20.000002',
  ...over,
})

describe('room frames', () => {
  it('decodes a room frame from an unknown socket frame, and nothing else', () => {
    expect(decodeRoomFrame(room())).toEqual({
      channelId: 'C1', roomId: 'R2', participants: ['U0ME', 'U0MAYA'], ended: false, startedAt: 1_790_000_000_000, threadTs: undefined, createdBy: undefined, eventTs: '20.000002',
    })
    expect(decodeRoomFrame({ type: 'huddle_invite_cancel', channel_id: 'C1' })).toBeUndefined()
    expect(decodeRoomFrame({ type: 'sh_room_join', user: 'U0MAYA' })).toBeUndefined()
  })

  it('reads the channel from the room when the frame has no huddle, and an empty room as ended', () => {
    const { huddle: _, ...noHuddle } = room({ type: 'sh_room_leave', room: { id: 'R2', channels: ['C9'], participants: [] } })
    expect(decodeRoomFrame(noHuddle)).toMatchObject({ channelId: 'C9', ended: true })
  })

  it.each([
    ['epoch seconds', 1_790_000_000, 1_790_000_000_000],
    ['milliseconds', 1_790_000_000_000, undefined],
    ['a small number', 42, undefined],
  ])('takes a start time in %s as %p', (_, dateStart, startedAt) => {
    expect(decodeRoomFrame(room({ room: { id: 'R2', participants: ['U0ME'], date_start: dateStart } }))?.startedAt).toBe(startedAt)
  })

  const shown: Running = applyRoomFrame(new Map(), decodeRoomFrame(room())!)
  // [what came, the frame, who C1 shows after it: 'same' when the frame changes nothing]
  it.each<[string, Record<string, unknown>, ReadonlyArray<string> | 'same' | 'ended']>([
    ['the same frame again', {}, 'same'],
    ['an older frame of the room', { type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'] }, event_ts: '19.000001' }, 'same'],
    ['a newer frame of another room that ended', { type: 'sh_room_leave', room: { id: 'R1', participants: [], has_ended: true }, event_ts: '30.000001' }, 'same'],
    ['a newer frame of another room', { room: { id: 'R3', participants: ['U0LEO'] }, event_ts: '31.000001' }, 'same'],
    ['a newer frame of the room', { type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'] }, event_ts: '21.000001' }, ['U0ME']],
    ['a newer frame of the room, empty', { type: 'sh_room_leave', room: { id: 'R2', participants: [] }, event_ts: '22.000001' }, 'ended'],
  ])('%s', (_, over, expected) => {
    const next = applyRoomFrame(shown, decodeRoomFrame(room(over))!)
    if (expected === 'same') expect(next).toBe(shown)
    else if (expected === 'ended') expect(next.has('C1')).toBe(false)
    else expect(next.get('C1')?.participants).toEqual([...expected])
  })

  it('sets each channel read to what huddles/info said, an empty huddle as ended, and leaves the others', () => {
    const two = applyInfo(shown, ['C2'], [{ call_id: 'R5', channel_id: 'C2', active_members: ['U0LEO'], start_date: 1_790_000_100 }])
    expect([...two.keys()].toSorted()).toEqual(['C1', 'C2'])
    expect(applyInfo(two, ['C1'], []).has('C1')).toBe(false)
    expect(applyInfo(two, ['C2'], [{ call_id: 'R5', channel_id: 'C2', active_members: [] }]).has('C2')).toBe(false)
  })
})

describe('leaving after 10 minutes alone', () => {
  const MINUTE = 60_000
  const call = (participants: ReadonlyArray<string>, over: Partial<{ attendeeId: string | undefined; live: boolean; hasRemote: boolean }> = {}) =>
    ({ attendeeId: 'A1', live: true, selfId: 'U0ME', hasRemote: false, participants, ...over })

  it('counts from when the live call has nobody else, keeps that start, and starts again after someone joins or a new call', () => {
    const first = aloneNow(undefined, call(['U0ME']), 0)
    expect(aloneNow(first, call(['U0ME']), MINUTE)).toBe(first)
    expect(leaveAt(first!)).toBe(10 * MINUTE)
    expect(aloneNow(first, call(['U0ME', 'U0MAYA']), 9 * MINUTE)).toBeUndefined()
    expect(leaveAt(aloneNow(undefined, call(['U0ME']), 12 * MINUTE)!)).toBe(22 * MINUTE)
    expect(aloneNow(first, call(['U0ME'], { attendeeId: 'A2' }), 5 * MINUTE)).toEqual({ attendeeId: 'A2', since: 5 * MINUTE })
  })

  it.each([
    ['before the media is up', call(['U0ME'], { live: false })],
    ['without a call', call([], { attendeeId: undefined })],
    ['before Slack says who is in it', call([])],
    ['when the roster lacks the user', call(['U0MAYA'])],
    ['while the media hears someone', call(['U0ME'], { hasRemote: true })],
  ])('does not count %s', (_, input) => {
    expect(aloneNow(undefined, input, 0)).toBeUndefined()
  })
})
