// The pure rules of @juno/huddle: room frame decoding and merging, and the
// lifecycle with the pages' media as current state (specs/huddle.qnt). The flows themselves
// are tested in the engine against the fake Slack (engine/test/huddle.test.ts).
import { describe, expect, it } from 'vitest'
import type { HuddlePageReport } from '@juno/contract'
import * as L from '../src/lifecycle'
import { mediaStopped, type MediaView } from '../src/media'
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

interface ViewInput {
  readonly live?: ReadonlyArray<string>
  readonly gone?: ReadonlyArray<string>
  readonly reports?: ReadonlyArray<Partial<HuddlePageReport> & { readonly generation: string }>
  readonly handed?: ReadonlyArray<string>
  readonly reported?: boolean
}
/** The pages' state: main lists `live`, listed `gone` before; each page's latest report; this process's hand-offs in order. */
const view = ({ live = [G1], gone = [], reports = [], handed = [], reported = true }: ViewInput = {}): MediaView => ({
  pages: { reported, live: new Set(live), seen: new Set([...live, ...gone]) },
  reports: new Map(reports.map((r) => [r.generation, { seq: 1, holds: null, received: null, connection: 'connected', muted: false, ended: null, ...r }])),
  handed: new Map(handed.map((attendeeId, at) => [attendeeId, at + 1])),
})
/** G1 holds A1's session, after its hand-off. */
const inCall = view({ reports: [{ generation: G1, holds: 'A1', received: 'A1' }], handed: ['A1'] })
/** G1 reports it stopped A1. */
const stoppedA = (reason: 'left' | 'anotherDevice' = 'left') => view({ reports: [{ generation: G1, received: 'A1', ended: { attendeeId: 'A1', reason } }], handed: ['A1'] })

const answered = (s: L.Lifecycle, media: MediaView, identity: L.Identity) => L.answerJoin(s, L.recordFor(s, media, identity), WS)
/** Sent, as `drive` and the client's `beforeSend` do. */
const sent = (s: L.Lifecycle, attendeeId: string) => L.dispatched(L.sending(s, attendeeId), attendeeId)
const joinedA = (() => {
  const wanted = L.choose(L.initial, intent('C1', 1))
  if (!L.canRequest(wanted, view(), WS, true)) throw new Error('should request')
  return answered(L.requestJoin(wanted), view(), a)
})()

describe('lifecycle: the pages as current state', () => {
  it('holds a Start back until main lists its page, and never hands out to a page that went', () => {
    const wanted = L.choose(L.initial, intent('C1', 1, 'page-2'))
    expect(L.canRequest(wanted, view(), WS, true)).toBe(false)
    expect(L.canRequest(wanted, view({ live: [G1, 'page-2'] }), WS, true)).toBe(true)
    // The page went while its join was out: the answer is a leave no page holds.
    const out = L.requestJoin({ ...L.initial, wanted: intent('C1', 1) })
    const gone = view({ live: [], gone: [G1] })
    const s = answered(L.reconcile(out, gone), gone, a)
    expect(s.current).toBeUndefined()
    expect(s.pending).toEqual([{ record: { ...a, generation: null }, workspace: WS, dispatch: 'queued' }])
    expect(L.toClear(sent(s, 'A1'), gone, WS)).toEqual([{ ...a, generation: null }])
  })

  it('takes a report sent before the hand-off as saying nothing about it', () => {
    const before = view({ reports: [{ generation: G1, received: null }], handed: ['A1'] })
    expect(L.reconcile(joinedA, before).current).toEqual(joinedA.current)
    expect(L.phaseOf(joinedA, before)).toBe('joining')
    expect(L.phaseOf(joinedA, inCall)).toBe('joined')
  })

  it('ends the call once its page reports it stopped, with the page’s reason, and ignores other pages', () => {
    expect(L.reconcile(joinedA, view({ reports: [{ generation: 'page-0', received: 'A1' }], handed: ['A1'] })).current).toEqual(joinedA.current)
    const evicted = L.reconcile(joinedA, stoppedA('anotherDevice'))
    expect(evicted).toMatchObject({ current: undefined, otherDevice: true, ended: { channelId: 'C1', reason: 'anotherDevice' } })
    const cleared = L.clearLeave(sent(evicted, 'A1'), new Set(['A1']))
    expect(L.canRequest({ ...cleared, wanted: intent('C1', 4) }, view(), WS, true)).toBe(false)
    expect(L.canRequest(L.choose(cleared, intent('C1', 4)), view(), WS, true)).toBe(true)
  })

  it('ends the call when main lists its page gone', () => {
    expect(L.reconcile(joinedA, view({ live: [], gone: [G1], handed: ['A1'] }))).toMatchObject({ current: undefined, ended: { reason: 'connectionLost' } })
  })

  it('counts a record loaded after a restart as stopped by any report of its page in this process, whenever it came', () => {
    // Loaded from the store: not handed out by this process.
    const loaded = L.choose(L.restart(L.initial, [{ ...a, generation: G1 }], WS), intent('C2', 5))
    expect(L.canRequest(loaded, view(), WS, true)).toBe(false)
    expect(mediaStopped(view(), { ...a, generation: G1 })).toBe(false)
    const reportedEarly = view({ reports: [{ generation: G1, received: 'A0', ended: { attendeeId: 'A1', reason: 'left' } }] })
    expect(L.toClear(sent(loaded, 'A1'), reportedEarly, WS)).toEqual([{ ...a, generation: G1 }])
    // Its page not in main's first report: gone, since every live page is listed.
    expect(mediaStopped(view({ live: ['page-2'] }), { ...a, generation: G1 })).toBe(true)
    expect(mediaStopped(view({ live: [], reported: false }), { ...a, generation: G1 })).toBe(false)
  })
})

describe('lifecycle: leaves', () => {
  it('never sends a leave for the current attendee', () => {
    expect(L.toSend(joinedA, WS)).toEqual([])
    expect(L.toSend(L.leave(joinedA), WS)).toEqual([{ ...a, generation: G1 }])
  })

  it('clears a leave only once it went out and its media stopped, and keeps a refused one', () => {
    let s = L.choose(joinedA, intent('C2', 2))
    expect(L.canRequest(s, stoppedA(), WS, true)).toBe(false)
    s = L.sending(s, 'A1')
    expect(L.toClear(s, stoppedA(), WS)).toEqual([])
    s = L.refused(s, { ...a, generation: G1 }, WS)
    expect(L.toSend(s, WS)).toEqual([])
    s = L.retry(s, 'A1')
    expect(L.toSend(s, WS)).toEqual([{ ...a, generation: G1 }])
    s = sent(s, 'A1')
    expect(L.toClear(s, inCall, WS)).toEqual([])
    expect(L.toClear(s, stoppedA(), WS)).toEqual([{ ...a, generation: G1 }])
    s = L.clearLeave(s, new Set(['A1']))
    expect(L.canRequest(s, stoppedA(), WS, true)).toBe(true)
    // Refused after it was cleared: it comes back, to be sent again.
    expect(L.refused(s, { ...a, generation: G1 }, WS).pending).toEqual([{ record: { ...a, generation: G1 }, workspace: WS, dispatch: 'waiting' }])
  })

  it('an answer to a cancelled join is a leave, held by no page, never the current call', () => {
    const out = L.leave(L.requestJoin({ ...L.initial, wanted: intent('C2', 2) }))
    const s = answered(out, view(), b)
    expect(s.current).toBeUndefined()
    expect(s.pending).toEqual([{ record: { ...b, generation: null }, workspace: WS, dispatch: 'queued' }])
    expect(L.toSend(s, WS)).toEqual([{ ...b, generation: null }])
  })

  it('keeps the stop barrier across a workspace change, and leaves other workspaces their own leaves', () => {
    const away = L.detached(L.leave(joinedA), WS)
    const other = L.choose(L.restart(away, [], 'T2'), intent('C9', 6))
    expect(L.canRequest(other, inCall, 'T2', true)).toBe(false)
    expect(L.toSend(other, 'T2')).toEqual([])
    expect(L.canRequest(other, stoppedA(), 'T2', true)).toBe(true)
    expect(L.toSend(other, WS)).toEqual([{ ...a, generation: G1 }])
    expect(L.canRequest(L.choose(L.initial, intent('C2', 5)), view(), WS, false)).toBe(false)
  })
})
