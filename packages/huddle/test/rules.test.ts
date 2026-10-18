// The pure rules of @juno/huddle: room frame decoding and ordering, and the
// identity checks of the lifecycle (specs/huddle.qnt). The flows themselves
// are tested in the engine against the fake Slack (engine/test/huddle.test.ts).
import { describe, expect, it } from 'vitest'
import * as L from '../src/lifecycle'
import { applyInfo, applyRoomFrame, decodeRoomFrame, type Running } from '../src/running'

const room = (over: Record<string, unknown> = {}) => ({
  type: 'sh_room_join',
  user: 'U0MAYA',
  huddle: { channel_id: 'C1' },
  room: { id: 'R2', channels: ['C1'], participants: ['U0ME', 'U0MAYA'], date_start: 200, has_ended: false },
  event_ts: '20.000002',
  ...over,
})

describe('room frames', () => {
  it('decodes a room frame from an unknown socket frame, and nothing else', () => {
    expect(decodeRoomFrame(room())).toEqual({
      channelId: 'C1', roomId: 'R2', participants: ['U0ME', 'U0MAYA'], ended: false, startedAt: 200_000, threadTs: undefined, eventTs: '20.000002',
    })
    expect(decodeRoomFrame({ type: 'huddle_invite_cancel', channel_id: 'C1' })).toBeUndefined()
    expect(decodeRoomFrame({ type: 'sh_room_join', user: 'U0MAYA' })).toBeUndefined()
  })

  it('reads the channel from the room when the frame has no huddle, and an empty room as ended', () => {
    const { huddle: _, ...noHuddle } = room({ type: 'sh_room_leave', room: { id: 'R2', channels: ['C9'], participants: [] } })
    const frame = decodeRoomFrame(noHuddle)
    expect(frame?.channelId).toBe('C9')
    expect(frame?.ended).toBe(true)
  })

  const shown: Running = applyRoomFrame(new Map(), decodeRoomFrame(room())!)

  it('ignores a frame no newer than the last one of the same huddle', () => {
    const late = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'], date_start: 200 }, event_ts: '19.000001' }))!
    expect(applyRoomFrame(shown, late)).toBe(shown)
    const again = decodeRoomFrame(room())!
    expect(applyRoomFrame(shown, again)).toBe(shown)
  })

  it('ignores a frame from a huddle that started before the one shown', () => {
    const old = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R1', participants: [], has_ended: true, date_start: 100 }, event_ts: '30.000001' }))!
    expect(applyRoomFrame(shown, old)).toBe(shown)
  })

  it('applies a newer frame as the whole room, and drops an ended one', () => {
    const left = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'], date_start: 200 }, event_ts: '21.000001' }))!
    expect(applyRoomFrame(shown, left).get('C1')?.participants).toEqual(['U0ME'])
    const ended = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: [], date_start: 200 }, event_ts: '22.000001' }))!
    expect(applyRoomFrame(shown, ended).has('C1')).toBe(false)
  })

  it('sets each channel read to what huddles/info said, and leaves the others', () => {
    const two = applyInfo(shown, ['C2'], [{ call_id: 'R5', channel_id: 'C2', active_members: ['U0LEO'], start_date: 300 }])
    expect([...two.keys()].sort()).toEqual(['C1', 'C2'])
    expect(applyInfo(two, ['C1'], []).has('C1')).toBe(false)
  })
})

describe('lifecycle identity', () => {
  const a = { channelId: 'C1', callId: 'R1', attendeeId: 'A1' }
  const b = { channelId: 'C2', callId: 'R2', attendeeId: 'A2' }
  const intent = (channelId: string, ticket: number) => ({ channelId, region: null, ticket })

  const joinedA = (() => {
    const wanted = L.choose(L.initial, intent('C1', 1))
    if (!L.canRequest(wanted)) throw new Error('should request')
    return L.mediaStarted(L.answerJoin(L.requestJoin(wanted), a), 'A1')
  })()

  it('a report or start for another attendee does not touch the current call', () => {
    expect(L.mediaEnded(joinedA, 'A0', 'anotherDevice').current).toEqual(joinedA.current)
    expect(L.mediaStarted(L.answerJoin(L.requestJoin({ ...L.initial, wanted: intent('C1', 1) }), a), 'A0').current?.started).toBe(false)
    expect(L.mediaMuted(joinedA, 'A0', true).muted).toBe(false)
  })

  it('never sends a leave for the current attendee', () => {
    expect(L.toSend(joinedA)).toEqual([])
    expect(L.toSend(L.leave(joinedA))).toEqual([a])
  })

  it('a switch waits for the old leave to be sent and stopped before the next join', () => {
    let s = L.choose(joinedA, intent('C2', 2))
    expect(L.canRequest(s)).toBe(false)
    s = L.sendLeave(s, 'A1')
    expect(L.toClear(s)).toEqual([])
    s = L.mediaEnded(s, 'A1', 'left')
    expect(L.toClear(s)).toEqual([a])
    s = L.clearLeave(s, new Set(['A1']))
    expect(L.canRequest(s)).toBe(true)
  })

  it('an answer to a cancelled join is a leave, never the current call', () => {
    const out = L.leave(L.requestJoin({ ...L.initial, wanted: intent('C2', 2) }))
    const answered = L.answerJoin(out, b)
    expect(answered.current).toBeUndefined()
    expect(answered.pending).toEqual([{ identity: b, sent: false, stopped: true }])
    expect(L.toSend(answered)).toEqual([b])
  })

  it('after another device took over, nothing joins until a new Start', () => {
    const evicted = L.mediaEnded({ ...joinedA, wanted: intent('C2', 3) }, 'A1', 'anotherDevice')
    expect(evicted.current).toBeUndefined()
    expect(evicted.wanted).toBeUndefined()
    expect(evicted.ended).toEqual({ channelId: 'C1', reason: 'anotherDevice' })
    const cleared = L.clearLeave(L.sendLeave(evicted, 'A1'), new Set(['A1']))
    expect(L.canRequest({ ...cleared, wanted: intent('C1', 4) })).toBe(false)
    expect(L.canRequest(L.choose(cleared, intent('C1', 4)))).toBe(true)
  })

  it('stored leaves are pending again after a restart, ahead of any join', () => {
    const s = L.choose(L.restart(L.initial, [a], () => false), intent('C2', 5))
    expect(L.canRequest(s)).toBe(false)
    expect(L.toSend(s)).toEqual([a])
    expect(L.toClear(L.sendLeave(s, 'A1'))).toEqual([])
    expect(L.toClear(L.mediaIdle(L.sendLeave(s, 'A1')))).toEqual([a])
  })
})
