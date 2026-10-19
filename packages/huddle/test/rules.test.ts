// The pure rules of @juno/huddle: room frame decoding and merging, and the
// identity checks of the lifecycle (specs/huddle.qnt). The flows themselves
// are tested in the engine against the fake Slack (engine/test/huddle.test.ts).
import { describe, expect, it } from 'vitest'
import * as L from '../src/lifecycle'
import { applyInfo, applyRoomFrame, decodeRoomFrame, secondsToMillis, type Running } from '../src/running'

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
      channelId: 'C1', roomId: 'R2', participants: ['U0ME', 'U0MAYA'], ended: false, startedAt: 1_790_000_000_000, threadTs: undefined, eventTs: '20.000002',
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

  it('uses only times that are epoch seconds', () => {
    expect(secondsToMillis(1_790_000_000)).toBe(1_790_000_000_000)
    expect(secondsToMillis(1_790_000_000_000)).toBeNull()
    expect(secondsToMillis(42)).toBeNull()
    expect(decodeRoomFrame(room({ room: { id: 'R2', participants: ['U0ME'], date_start: 1_790_000_000_000 } }))?.startedAt).toBeUndefined()
  })

  const shown: Running = applyRoomFrame(new Map(), decodeRoomFrame(room())!)

  it('ignores a frame no newer than the last one of the same room', () => {
    const late = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'] }, event_ts: '19.000001' }))!
    expect(applyRoomFrame(shown, late)).toBe(shown)
    expect(applyRoomFrame(shown, decodeRoomFrame(room())!)).toBe(shown)
  })

  it('does not merge a frame about another room than the one shown, newer or older', () => {
    const other = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R1', participants: [], has_ended: true }, event_ts: '30.000001' }))!
    expect(applyRoomFrame(shown, other)).toBe(shown)
    const next = decodeRoomFrame(room({ room: { id: 'R3', participants: ['U0LEO'] }, event_ts: '31.000001' }))!
    expect(applyRoomFrame(shown, next)).toBe(shown)
  })

  it('applies a newer frame of the room as the whole room, and drops an ended one', () => {
    const left = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: ['U0ME'] }, event_ts: '21.000001' }))!
    expect(applyRoomFrame(shown, left).get('C1')?.participants).toEqual(['U0ME'])
    const ended = decodeRoomFrame(room({ type: 'sh_room_leave', room: { id: 'R2', participants: [] }, event_ts: '22.000001' }))!
    expect(applyRoomFrame(shown, ended).has('C1')).toBe(false)
  })

  it('sets each channel read to what huddles/info said, an empty huddle as ended, and leaves the others', () => {
    const two = applyInfo(shown, ['C2'], [{ call_id: 'R5', channel_id: 'C2', active_members: ['U0LEO'], start_date: 1_790_000_100 }])
    expect([...two.keys()].toSorted()).toEqual(['C1', 'C2'])
    expect(applyInfo(two, ['C1'], []).has('C1')).toBe(false)
    expect(applyInfo(two, ['C2'], [{ call_id: 'R5', channel_id: 'C2', active_members: [] }]).has('C2')).toBe(false)
  })
})

const WS = 'T1'
const G1 = 'page-1'
const a = { channelId: 'C1', callId: 'R1', attendeeId: 'A1' }
const b = { channelId: 'C2', callId: 'R2', attendeeId: 'A2' }
const intent = (channelId: string, ticket: number, generation = G1) => ({ channelId, region: null, generation, ticket })
const none: L.Gone = () => false
const answered = (s: L.Lifecycle, identity: L.Identity) => L.answerJoin(s, L.recordFor(s, identity), WS)
/** Sent, as `drive` and the client's `beforeSend` do. */
const sent = (s: L.Lifecycle, attendeeId: string) => L.dispatched(L.sending(s, attendeeId), attendeeId)
const joinedA = (() => {
  const wanted = L.choose(L.initial, intent('C1', 1))
  if (!L.canRequest(wanted, WS, true)) throw new Error('should request')
  return L.mediaStarted(answered(L.requestJoin(wanted), a), G1, 'A1')
})()

describe('lifecycle identity', () => {
  it('a report from another page, or about another attendee, does not touch the current call', () => {
    expect(L.mediaEnded(joinedA, 'page-0', 'A1', 'anotherDevice').current).toEqual(joinedA.current)
    expect(L.mediaEnded(joinedA, G1, 'A0', 'anotherDevice').current).toEqual(joinedA.current)
    expect(L.mediaMuted(joinedA, 'page-0', 'A1', true).muted).toBe(false)
    expect(L.mediaEnded(L.leave(joinedA), 'page-0', 'A1', 'left').pending[0]?.stopped).toBe(false)
  })

  it('never sends a leave for the current attendee', () => {
    expect(L.toSend(joinedA, WS)).toEqual([])
    expect(L.toSend(L.leave(joinedA), WS)).toEqual([{ ...a, generation: G1 }])
  })

  it('clears a leave only once it went out and its media stopped, and keeps a refused one', () => {
    let s = L.choose(joinedA, intent('C2', 2))
    expect(L.canRequest(s, WS, true)).toBe(false)
    s = L.mediaEnded(L.sending(s, 'A1'), G1, 'A1', 'left')
    expect(L.toClear(s, WS)).toEqual([])
    s = L.refused(s, { ...a, generation: G1 }, WS)
    expect(L.toSend(s, WS)).toEqual([])
    s = L.retry(s, 'A1')
    expect(L.toSend(s, WS)).toEqual([{ ...a, generation: G1 }])
    s = sent(s, 'A1')
    expect(L.toClear(s, WS)).toEqual([{ ...a, generation: G1 }])
    s = L.clearLeave(s, new Set(['A1']))
    expect(L.canRequest(s, WS, true)).toBe(true)
    // Refused after it was cleared: it comes back, to be sent again.
    expect(L.refused(s, { ...a, generation: G1 }, WS).pending).toEqual([{ record: { ...a, generation: G1 }, workspace: WS, dispatch: 'waiting', stopped: true }])
  })

  it('an answer to a cancelled join is a leave, held by no page, never the current call', () => {
    const out = L.leave(L.requestJoin({ ...L.initial, wanted: intent('C2', 2) }))
    const s = answered(out, b)
    expect(s.current).toBeUndefined()
    expect(s.pending).toEqual([{ record: { ...b, generation: null }, workspace: WS, dispatch: 'queued', stopped: true }])
    expect(L.toSend(s, WS)).toEqual([{ ...b, generation: null }])
  })

})

describe('lifecycle recovery', () => {  it('a page main calls gone stops what it held, and ends the call it ran', () => {
    const s = L.pagesGone(joinedA, (generation) => generation === G1)
    expect(s.current).toBeUndefined()
    expect(s.ended).toEqual({ channelId: 'C1', reason: 'connectionLost' })
    expect(s.pending[0]?.stopped).toBe(true)
    expect(L.pagesGone(joinedA, (generation) => generation === 'page-0')).toEqual(joinedA)
  })

  it('after another device took over, nothing joins until a new Start', () => {
    const evicted = L.mediaEnded(joinedA, G1, 'A1', 'anotherDevice')
    expect(evicted.ended).toEqual({ channelId: 'C1', reason: 'anotherDevice' })
    const cleared = L.clearLeave(sent(evicted, 'A1'), new Set(['A1']))
    expect(L.canRequest({ ...cleared, wanted: intent('C1', 4) }, WS, true)).toBe(false)
    expect(L.canRequest(L.choose(cleared, intent('C1', 4)), WS, true)).toBe(true)
  })

  it('stored leaves are pending after a restart, ahead of any join, and wait for their page', () => {
    const s = L.choose(L.restart(L.initial, [{ ...a, generation: G1 }], WS, none), intent('C2', 5, 'page-2'))
    expect(L.canRequest(s, WS, true)).toBe(false)
    expect(L.toClear(sent(s, 'A1'), WS)).toEqual([])
    expect(L.toClear(L.pagesGone(sent(s, 'A1'), (generation) => generation === G1), WS)).toEqual([{ ...a, generation: G1 }])
    expect(L.canRequest(L.choose(L.initial, intent('C2', 5)), WS, false)).toBe(false)
  })

  it('keeps the stop barrier across a workspace change, and leaves other workspaces their own leaves', () => {
    const away = L.detached(L.leave(joinedA), WS)
    const other = L.choose(L.restart(away, [], 'T2', none), intent('C9', 6))
    expect(L.canRequest(other, 'T2', true)).toBe(false)
    expect(L.toSend(other, 'T2')).toEqual([])
    const stopped = L.mediaEnded(other, G1, 'A1', 'left')
    expect(L.canRequest(stopped, 'T2', true)).toBe(true)
    expect(L.toSend(stopped, WS)).toEqual([{ ...a, generation: G1 }])
  })
})
