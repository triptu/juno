import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Emoji, OpenTarget, selectionSnippet, selectionSource, selectionTooltip, type Selection, sendMessageStatus, type ProposedMessage } from '../src/index'

const decodeOpen = Schema.decodeUnknownSync(OpenTarget)

describe('OpenTarget url', () => {
  it('accepts https anywhere and http on loopback', () => {
    for (const url of ['https://github.com/t3/juno/pull/412', 'HTTPS://notion.so/page', 'http://localhost:3773/thread/1', 'http://127.0.0.1/x', 'http://[::1]:3773', 't3-thread://v1/thread-1']) {
      expect(decodeOpen({ _tag: 'url', url, label: 'Open' })).toEqual({ _tag: 'url', url, label: 'Open' })
    }
  })

  it('refuses every other scheme and plain http off loopback', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'x-juno://open', 'http://192.168.1.22:3773/mcp', 'http://localhost.evil.com/', 'https://', 'notaurl', 't3-thread://v1/../other', 't3-thread://v1/thread?command=run']) {
      expect(() => decodeOpen({ _tag: 'url', url, label: 'Open' })).toThrow()
    }
  })
})

describe('the selection chip', () => {
  const label = (selection: Selection) => [selectionSource(selection), selectionSnippet(selection)].filter(Boolean).join(': ')

  it('names the sender and quotes a short selection whole', () => {
    expect(label({ text: 'ship it Monday', sender: 'Maya' })).toBe('Maya: “ship it Monday”')
  })

  it('cuts a long selection at a word, on one line, with the whole of it in the tooltip', () => {
    const text = 'The deploy failed on staging\nbecause the migration timed out.'
    expect(label({ text, sender: 'Maya' })).toBe('Maya: “The deploy failed on staging…”')
    expect(selectionTooltip({ text, sender: 'Maya' })).toBe('Maya: The deploy failed on staging because the migration timed out.')
  })

  it('counts the messages of a selection across several, in place of a sender', () => {
    expect(label({ text: 'yes\nno', sender: 'Maya', messages: 3 })).toBe('3 messages: “yes no”')
  })

  it('quotes alone when there is no sender, and never splits an emoji', () => {
    expect(label({ text: `${'a'.repeat(27)}👍 more` })).toBe(`“${'a'.repeat(27)}…”`)
  })
})

describe('Emoji', () => {
  it('takes any single emoji, including sequences, flags and skin tones', () => {
    for (const emoji of ['👍', '🎉', '❤️', '👍🏽', '👩‍💻', '🇮🇳', '1️⃣']) expect(Schema.decodeUnknownSync(Emoji)(emoji)).toBe(emoji)
  })

  it('refuses text, two emoji and the empty string', () => {
    for (const text of ['', 'ok', '👍👍', '👍 ', 'a👍']) expect(() => Schema.decodeUnknownSync(Emoji)(text)).toThrow()
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
