import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { OpenTarget, sendMessageStatus, type ProposedMessage } from '../src/index'

const decodeOpen = Schema.decodeUnknownSync(OpenTarget)

describe('OpenTarget url', () => {
  it('accepts https anywhere and http on loopback', () => {
    for (const url of ['https://github.com/t3/juno/pull/412', 'HTTPS://notion.so/page', 'http://localhost:3773/thread/1', 'http://127.0.0.1/x', 'http://[::1]:3773']) {
      expect(decodeOpen({ _tag: 'url', url, label: 'Open' })).toEqual({ _tag: 'url', url, label: 'Open' })
    }
  })

  it('refuses every other scheme and plain http off loopback', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'x-juno://open', 'http://192.168.1.22:3773/mcp', 'http://localhost.evil.com/', 'https://', 'notaurl']) {
      expect(() => decodeOpen({ _tag: 'url', url, label: 'Open' })).toThrow()
    }
  })
})

const row = (id: string, result: ProposedMessage['result']): ProposedMessage => ({
  id: id as ProposedMessage['id'],
  target: { channelId: 'C1', name: 'eng', kindLabel: 'Public channel', tint: 'public' },
  text: 'Wednesday works.',
  result,
})
const open = { _tag: 'topic', topicId: 't1' } as const

describe('sendMessageStatus', () => {
  it('is working while any row is unresolved', () => {
    expect(sendMessageStatus([row('a', { _tag: 'sent', open }), row('b', { _tag: 'sending' })])).toEqual({ _tag: 'working' })
    expect(sendMessageStatus([row('a', { _tag: 'pending' })])).toEqual({ _tag: 'working' })
  })

  it('counts what was sent', () => {
    expect(sendMessageStatus([row('a', { _tag: 'sent', open })])).toEqual({ _tag: 'done', line: 'Sent' })
    expect(sendMessageStatus([row('a', { _tag: 'sent', open }), row('b', { _tag: 'sent', open })])).toEqual({ _tag: 'done', line: 'Sent 2' })
    expect(sendMessageStatus([row('a', { _tag: 'sent', open }), row('b', { _tag: 'failed' }), row('c', { _tag: 'failed' })])).toEqual({
      _tag: 'done',
      line: 'Sent 1 of 3',
    })
  })

  it('says Failed, with nothing to click, when no row was sent', () => {
    expect(sendMessageStatus([row('a', { _tag: 'failed' }), row('b', { _tag: 'failed' })])).toEqual({ _tag: 'failed', line: 'Failed' })
  })
})
