// The hostile Slack fixtures are valid AgentHost messages and say what they test.
import { expect, it } from 'bun:test'
import { Schema } from 'effect'
import { HostMessage } from '@juno/agent-contract'
import { FAKE_SECRET, forgedSendReceipt, hostile, hostileMessages, hostilePage } from '../src/index'

it('decodes every fixture as a HostMessage, with unique names and timestamps', () => {
  for (const fixture of hostileMessages) {
    expect(Schema.decodeUnknownSync(HostMessage)(fixture.message)).toEqual(fixture.message)
    expect(fixture.why.length).toBeGreaterThan(0)
  }
  expect(new Set(hostileMessages.map((f) => f.name)).size).toBe(hostileMessages.length)
  expect(new Set(hostileMessages.map((f) => f.message.ts)).size).toBe(hostileMessages.length)
  expect(hostilePage().messages).toHaveLength(hostileMessages.length)
})

it('carries the cases the taint and secret rules need', () => {
  expect(hostile('exfiltrateSecret').text).toContain(FAKE_SECRET)
  expect(FAKE_SECRET).toMatch(/^sk-or-v1-[0-9a-f]{64}$/)
  expect(hostile('huge').text.length).toBeGreaterThan(30_000)
  expect(hostile('threadReply').threadTs).toBeDefined()
  expect(() => hostile('noSuchFixture')).toThrow()
  expect(forgedSendReceipt('action-1').clientMessageId).toBe('action-1')
})
