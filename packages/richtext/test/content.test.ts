import { Message } from '@juno/slack-schema'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { customEmojiLookup, inlinesOf, messageBody, plainText, reactionDisplay } from '../src/index'

const emoji = customEmojiLookup([
  { name: 'juno_wave', url: 'https://example.test/wave.gif' },
  { name: 'hello', alias_for: 'juno_wave' },
  { name: 'greeting', alias_for: 'hello' },
  { name: 'broken', alias_for: 'missing' },
  { name: 'cycle', alias_for: 'cycle' },
])
const render = (payload: unknown) => messageBody(Schema.decodeUnknownSync(Message)(payload), { emoji })

describe('message content from Slack', () => {
  it.each([
    ['rich date', { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14, 2023', url: 'https://example.test/calendar' }] }] }] }],
    ['mrkdwn date', { text: '<!date^1700000000^{date_short}^https://example.test/calendar|Nov 14, 2023>' }],
  ])('preserves the date and its link from %s', (_, content) => {
    const body = render({ ts: '1700000000.000000', ...content })
    expect(plainText(body)).toBe('Nov 14, 2023')
    expect(inlinesOf(body).find((inline) => inline.kind === 'date')).toMatchObject({ timestamp: 1700000000, format: '{date_short}', url: 'https://example.test/calendar' })
  })

  it.each([
    ['original dimensions', { original_w: 800, original_h: 600 }, { width: 800, height: 600 }],
    ['thumbnail dimensions', { thumb_360_w: 360, thumb_360_h: 270 }, { width: 360, height: 270 }],
    ['missing dimensions', {}, {}],
    ['invalid dimensions', { original_w: 0, original_h: 600 }, {}],
  ])('keeps file geometry with %s', (_, dimensions, expected) => {
    const body = render({ ts: '1700000000.000000', text: 'See the diagram', files: [{ id: 'F0DIAGRAM', name: 'diagram.png', mimetype: 'image/png', ...dimensions }] })
    expect(plainText(body)).toBe('See the diagram\ndiagram.png')
    const file = body.blocks.find((block) => block.kind === 'file')
    expect(file).toMatchObject({ id: 'F0DIAGRAM', name: 'diagram.png', mimetype: 'image/png', ...expected })
    if (!('width' in expected)) expect(file).not.toHaveProperty('width')
  })

  it.each([
    [{ fallback: 'Build passed', text: 'Duplicate details' }, 'Duplicate details'],
    [{ title: 'Build', text: 'Passed', fields: [{ title: 'Revision', value: 'abc' }] }, 'Build\nPassed\nRevision\nabc'],
  ])('prefers attachment content to fallback summaries', (attachment, expected) => {
    const body = render({ ts: '1700000000.000000', text: 'Status', attachments: [attachment] })
    expect(plainText(body)).toBe(`Status\n${expected}`)
  })

  it.each(['juno_wave', 'hello', 'greeting', 'broken', 'cycle'])('renders workspace emoji %s', (name) => {
    const body = render({ ts: '1700000000.000000', blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'emoji', name }] }] }] })
    const display = reactionDisplay(name, emoji)
    const inline = inlinesOf(body).find((item) => item.kind === 'emoji')
    if (name === 'broken' || name === 'cycle') {
      expect(plainText(body)).toBe(`:${name}:`)
      expect(display).toEqual({ kind: 'name', value: name })
    } else {
      expect(inline).toMatchObject({ url: 'https://example.test/wave.gif' })
      expect(display).toEqual({ kind: 'image', url: 'https://example.test/wave.gif' })
    }
  })
})
