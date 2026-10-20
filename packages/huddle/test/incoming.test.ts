// Which huddles get the incoming card (SPEC 20, "Incoming huddles"), and when the card goes.
import { describe, expect, it } from 'vitest'
import type { HuddleCall, RunningHuddle, RunningHuddles } from '@juno/contract'
import { dismiss, incomingOf, lookAt, noIncoming, offer, settle, NEW_HUDDLE_MILLIS, RING_MILLIS } from '../src/incoming'

const NOW = 1_790_000_000_000
const SELF = 'U0ME'
const huddle = (over: Partial<RunningHuddle> = {}): RunningHuddle => ({ callId: 'R1', participants: ['U0MAYA'], startedAt: NOW - 2_000, threadTs: null, createdBy: 'U0MAYA', ...over })
const idle: HuddleCall = { phase: 'idle', channelId: null, callId: null, attendeeId: null, participants: [], startedAt: null, connection: null, muted: false, ended: null }
const inCall = (channelId: string): HuddleCall => ({ ...idle, phase: 'joined', channelId, callId: 'R9' })

const offered = (running: RunningHuddles, call: HuddleCall = idle) => {
  const looked = lookAt(noIncoming, running, SELF, NOW)
  return settle(offer(looked.state, looked.fresh.map((fresh) => incomingOf(fresh, 'ring', call, NOW))), running, call, SELF)
}

describe('incoming huddles', () => {
  it('offers a huddle someone else just started, once, ringing for 30 seconds', () => {
    const running = { C1: huddle() }
    const state = offered(running)
    expect(state.list).toEqual([{ channelId: 'C1', callId: 'R1', startedBy: 'U0MAYA', participants: ['U0MAYA'], alert: 'ring', ringUntil: NOW + RING_MILLIS }])
    expect(lookAt(state, running, SELF, NOW).fresh).toEqual([])
  })

  it('offers none the user started, here or on another device, or is already in, or that has run a while', () => {
    expect(offered({ C1: huddle({ createdBy: SELF, participants: [SELF] }) }).list).toEqual([])
    expect(offered({ C1: huddle({ createdBy: null, participants: [SELF, 'U0MAYA'] }) }).list).toEqual([])
    expect(offered({ C1: huddle({ participants: ['U0MAYA', SELF] }) }).list).toEqual([])
    expect(offered({ C1: huddle({ startedAt: NOW - NEW_HUDDLE_MILLIS - 1 }) }).list).toEqual([])
    expect(offered({ C1: huddle({ startedAt: null }) }).list).toEqual([])
  })

  it('takes the first to join as the starter when Slack does not say', () => {
    expect(offered({ C1: huddle({ createdBy: null, participants: ['U0LEO', 'U0MAYA'] }) }).list[0]?.startedBy).toBe('U0LEO')
  })

  it('does not ring while the user is in a call, and stops the ring when they join one', () => {
    expect(offered({ C1: huddle() }, inCall('C2')).list[0]?.ringUntil).toBeNull()
    const state = offered({ C1: huddle() })
    expect(settle(state, { C1: huddle(), C2: huddle({ callId: 'R9' }) }, inCall('C2'), SELF).list[0]?.ringUntil).toBeNull()
  })

  it('lists the newest first, and drops one on a join, an end, a new call there or a dismiss', () => {
    const first = offered({ C1: huddle() })
    const running = { C1: huddle(), C2: huddle({ callId: 'R2' }) }
    const looked = lookAt(first, running, SELF, NOW)
    const both = offer(looked.state, looked.fresh.map((fresh) => incomingOf(fresh, 'quiet', idle, NOW)))
    expect(both.list.map((entry) => entry.callId)).toEqual(['R2', 'R1'])
    expect(both.list[0]?.ringUntil).toBeNull()
    expect(settle(both, running, { ...inCall('C1'), phase: 'joining' }, SELF).list.map((entry) => entry.callId)).toEqual(['R2'])
    expect(settle(both, { C1: huddle({ participants: ['U0MAYA', SELF] }), C2: huddle({ callId: 'R2' }) }, idle, SELF).list.map((entry) => entry.callId)).toEqual(['R2'])
    expect(settle(both, { C2: huddle({ callId: 'R2' }) }, idle, SELF).list.map((entry) => entry.callId)).toEqual(['R2'])
    expect(settle(both, { C1: huddle({ callId: 'R3' }), C2: huddle({ callId: 'R2' }) }, idle, SELF).list.map((entry) => entry.callId)).toEqual(['R2'])
    expect(dismiss(both, 'R2').list.map((entry) => entry.callId)).toEqual(['R1'])
  })

  it('keeps who is in it up to date, and the same state when nothing changed', () => {
    const state = offered({ C1: huddle() })
    expect(settle(state, { C1: huddle() }, idle, SELF)).toBe(state)
    expect(settle(state, { C1: huddle({ participants: ['U0MAYA', 'U0LEO'] }) }, idle, SELF).list[0]?.participants).toEqual(['U0MAYA', 'U0LEO'])
  })
})
