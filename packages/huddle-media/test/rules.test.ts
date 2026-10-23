import { MeetingSessionStatusCode as Code } from 'amazon-chime-sdk-js'
import { describe, expect, it } from 'bun:test'
import { endReasonOf } from '../src/chime/endReason.ts'
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

describe("why a call ended: the context Chime's stop code does not give", () => {
  // The code itself maps one to one (endReason.ts); these two rules read what the session did before it.
  it('reads any stop after leave() as left', () => {
    expect(endReasonOf(Code.SignalingChannelClosedUnexpectedly, { leaving: true, everConnected: true })).toBe('left')
  })

  it('reads a dropped connection before the call ever connected as a failed join', () => {
    expect(endReasonOf(Code.SignalingChannelClosedUnexpectedly, { leaving: false, everConnected: false })).toBe('failed')
    expect(endReasonOf(Code.SignalingChannelClosedUnexpectedly, { leaving: false, everConnected: true })).toBe('connection-lost')
  })
})
