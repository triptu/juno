import { MeetingSessionStatusCode as Code } from 'amazon-chime-sdk-js'
import { describe, expect, it } from 'bun:test'
import { endReasonOf } from '../src/chime/endReason.ts'
import { microphoneProblem } from '../src/chime/microphone.ts'
import { slackUserIdOf } from '../src/externalUserId.ts'

describe('the Slack user in a Chime ExternalUserId', () => {
  it.each([
    ['T0123456789-R0123456789-U0123456789', 'U0123456789'],
    ['T0123456789-R0123456789-W0123456789', 'W0123456789'],
    ['T0123456789-R0123456789-U0123456789#content', 'U0123456789'],
  ])('reads %s', (external, user) => {
    expect(slackUserIdOf(external)).toBe(user)
  })

  it.each(['', 'U0123456789', 'T0123456789-U0123456789', 'T0123456789-R0123456789-U0123456789-extra', 't0123-r0123-u0123'])('finds no user in %j', (external) => {
    expect(slackUserIdOf(external)).toBeUndefined()
  })
})

describe("why a call ended, from Chime's stop code", () => {
  const live = { leaving: false, everConnected: true }

  it.each([
    [Code.Left, 'left'],
    [Code.AudioJoinedFromAnotherDevice, 'another-device'],
    [Code.MeetingEnded, 'meeting-ended'],
    [Code.AudioAttendeeRemoved, 'removed'],
    [Code.AudioCallAtCapacity, 'full'],
    [Code.SignalingChannelClosedUnexpectedly, 'connection-lost'],
    [Code.ConnectionHealthReconnect, 'connection-lost'],
    [Code.AudioAuthenticationRejected, 'failed'],
    [Code.TURNCredentialsForbidden, 'failed'],
  ])('reads code %s as %s', (code, reason) => {
    expect(endReasonOf(code, live)).toBe(reason)
  })

  it('reads any stop after leave() as left', () => {
    expect(endReasonOf(Code.SignalingChannelClosedUnexpectedly, { leaving: true, everConnected: true })).toBe('left')
  })

  it('reads a dropped connection before the call ever connected as a failed join', () => {
    expect(endReasonOf(Code.SignalingChannelClosedUnexpectedly, { leaving: false, everConnected: false })).toBe('failed')
  })
})

describe('why the microphone would not start', () => {
  const named = (name: string) => Object.assign(new Error(name), { name })
  it.each([
    ['PermissionDeniedError', 1, 'denied'],
    ['PermissionDeniedError', 0, 'denied'],
    ['NotFoundError', 1, 'unavailable'],
    ['NotReadableError', 0, 'unavailable'],
    ['NotReadableError', 1, 'failed'],
    ['GetUserMediaError', 2, 'failed'],
  ] as const)('%s with %i microphones is %s', (name, count, access) => {
    expect(microphoneProblem(named(name), count)).toBe(access)
  })
})
