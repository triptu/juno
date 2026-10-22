import { expect, it } from 'vitest'
import * as L from '../src/lifecycle'
import { callRoom, followOwn, frameOwn, readOwn, type OwnRoom } from '../src/own'
import { applyInfo, type RoomFrame } from '../src/running'

const current = (attendeeId = 'A1', callId = 'R1'): L.Lifecycle => ({
  ...L.initial, current: { identity: { attendeeId, callId, channelId: 'C1' }, generation: 1 },
})
const room = (): OwnRoom => ({ attendeeId: 'A1', callId: 'R1', participants: ['ME', 'MAYA'], startedAt: 1000, joinedAt: 2000, eventTs: '20' })
const frame = (over: Partial<RoomFrame> = {}): RoomFrame => ({ channelId: 'C1', roomId: 'R1', participants: ['ME'], startedAt: undefined, ended: false, eventTs: '21', threadTs: undefined, createdBy: undefined, ...over })

it('keeps its room after a missing read, accepts a later leave, and rejects an older frame even without a running entry', () => {
  const core: { s: L.Lifecycle; own: OwnRoom | undefined } = { s: current(), own: room() }
  readOwn(core, ['C1'], new Map())
  expect(callRoom(core.s, new Map(), core.own)).toMatchObject({ participants: ['ME', 'MAYA'], startedAt: 1000 })
  frameOwn(core, frame())
  frameOwn(core, frame({ participants: ['ME', 'MAYA'], eventTs: '19' }))
  expect(callRoom(core.s, new Map(), core.own)?.participants).toEqual(['ME'])
  frameOwn(core, frame({ ended: true, participants: [], eventTs: '22' }))
  expect(callRoom(core.s, new Map(), core.own)?.participants).toEqual([])
  expect(core.s.current?.identity.attendeeId).toBe('A1')
})

it('keeps a known start through partial reads and never borrows another room in the same channel', () => {
  const core: { s: L.Lifecycle; own: OwnRoom | undefined } = { s: current(), own: room() }
  readOwn(core, ['C1'], applyInfo(new Map(), ['C1'], [{ channel_id: 'C1', call_id: 'R1', active_members: ['ME'] }]))
  expect(core.own).toMatchObject({ participants: ['ME'], startedAt: 1000 })
  const nextRoom = applyInfo(new Map(), ['C1'], [{ channel_id: 'C1', call_id: 'R2', active_members: ['LEO'] }])
  readOwn(core, ['C1'], nextRoom)
  frameOwn(core, frame({ roomId: 'R2', participants: ['LEO'], eventTs: '99' }))
  expect(callRoom(core.s, nextRoom, core.own)).toMatchObject({ participants: ['ME'], startedAt: 1000 })
})

it('drops the retained room on leave and cannot reuse it for a new attendee, even in the same room', () => {
  const core: { s: L.Lifecycle; own: OwnRoom | undefined } = { s: current(), own: room() }
  core.s = L.leave(core.s)
  followOwn(core)
  expect(core.own).toBeUndefined()
  core.s = current('A2')
  core.own = room()
  expect(callRoom(core.s, new Map(), core.own)).toBeUndefined()
  followOwn(core)
  expect(core.own).toBeUndefined()
})
