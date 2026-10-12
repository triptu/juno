import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  Block,
  ChatPostMessageArgs,
  compareTs,
  decodeRtmFrame,
  encodeRtmFrame,
  Message,
  Methods,
  millisToTs,
  permalinkPath,
  RichTextInline,
  tsToMillis,
} from '@juno/slack/schemas'

describe('tolerant decoding', () => {
  it('keeps decoding when Slack adds keys', () => {
    const message = Schema.decodeUnknownSync(Message)({
      type: 'message',
      ts: '1760000000.000100',
      user: 'U0MAYA',
      text: 'hi',
      brand_new_field: { nested: true },
    })
    expect(message.ts).toBe('1760000000.000100')
    expect('brand_new_field' in message).toBe(false)
  })

  it('turns unknown rich text elements and blocks into the unknown variant and encodes them back', () => {
    const decodeInline = Schema.decodeUnknownSync(RichTextInline)
    const element = decodeInline({ type: 'workflowtoken', workflow_id: 'W1', text: 'Run' })
    expect(element).toEqual({ type: 'unknown', raw: { type: 'workflowtoken', workflow_id: 'W1', text: 'Run' } })
    expect(Schema.encodeSync(RichTextInline)(element)).toEqual({ type: 'workflowtoken', workflow_id: 'W1', text: 'Run' })

    const block = Schema.decodeUnknownSync(Block)({ type: 'actions', elements: [] })
    expect(block.type).toBe('unknown')
  })

  it('decodes a rich_text block with every inline kind', () => {
    const block = Schema.decodeUnknownSync(Block)({
      type: 'rich_text',
      block_id: 'b1',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'text', text: 'Hey ', style: { bold: true } },
            { type: 'user', user_id: 'U0ALEX' },
            { type: 'channel', channel_id: 'C0ENG' },
            { type: 'usergroup', usergroup_id: 'S1' },
            { type: 'broadcast', range: 'here' },
            { type: 'emoji', name: 'tada', unicode: '1f389' },
            { type: 'link', url: 'https://example.com', text: 'docs' },
            { type: 'date', timestamp: 1760000000, format: '{date_short}' },
          ],
        },
        { type: 'rich_text_quote', elements: [{ type: 'text', text: 'quoted' }] },
        { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'code' }], border: 0 },
        { type: 'rich_text_list', style: 'bullet', indent: 0, elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one' }] }] },
        { type: 'rich_text_divider' },
      ],
    })
    expect(block.type).toBe('rich_text')
    if (block.type !== 'rich_text') throw new Error('unreachable')
    expect(block.elements.map((e) => e.type)).toEqual([
      'rich_text_section',
      'rich_text_quote',
      'rich_text_preformatted',
      'rich_text_list',
      'rich_text_divider',
    ])
  })
})

describe('socket frames', () => {
  it('decodes known frames by type', () => {
    expect(decodeRtmFrame({ type: 'hello', region: 'fake' })).toEqual({ type: 'hello', region: 'fake' })
    expect(decodeRtmFrame({ type: 'pong', reply_to: 16385 })).toEqual({ type: 'pong', reply_to: 16385 })
    const changed = decodeRtmFrame({
      type: 'message',
      subtype: 'message_changed',
      channel: 'C0ENG',
      ts: '1760000000.000200',
      message: { ts: '1760000000.000100', text: 'edited', edited: { user: 'U0LEO', ts: '1760000000.000200' } },
      event_ts: '1760000000.000200',
    })
    expect(changed.type).toBe('message')
    if (changed.type !== 'message') throw new Error('unreachable')
    expect(changed.subtype).toBe('message_changed')
  })

  it('decodes unknown frame types to the unknown variant with the raw frame', () => {
    const frame = decodeRtmFrame({ type: 'canvas_updated', canvas: 'F1' })
    expect(frame).toEqual({ type: 'unknown', raw: { type: 'canvas_updated', canvas: 'F1' } })
    expect(encodeRtmFrame(frame)).toEqual({ type: 'canvas_updated', canvas: 'F1' })
    // Acks to outgoing frames have no type at all.
    expect(decodeRtmFrame({ ok: true, reply_to: 3 })).toEqual({ type: 'unknown', raw: { ok: true, reply_to: 3 } })
  })

  it('fails on a known frame type with an unexpected shape instead of misreading it', () => {
    expect(() => decodeRtmFrame({ type: 'message', subtype: 'message_changed', channel: 'C0ENG', ts: '1.000000' })).toThrow()
    expect(() => decodeRtmFrame({ type: 'reaction_added', user: 'U1' })).toThrow()
  })
})

describe('form arguments', () => {
  it('encodes typed arguments to form strings and decodes them back', () => {
    const encode = Schema.encodeSync(ChatPostMessageArgs)
    const form = encode({
      channel: 'C0ENG',
      text: 'hi',
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'hi' }] }] }],
      reply_broadcast: false,
      client_msg_id: 'uuid-1',
    })
    expect(form.reply_broadcast).toBe('false')
    expect(typeof form.blocks).toBe('string')
    const back = Schema.decodeUnknownSync(ChatPostMessageArgs)(form)
    expect(back.reply_broadcast).toBe(false)
    expect(back.blocks?.[0]?.type).toBe('rich_text')
  })

  it('decodes an ok and an error response of the same method', () => {
    const decode = Schema.decodeUnknownSync(Methods['conversations.mark'].response)
    expect(decode({ ok: true })).toEqual({ ok: true })
    expect(decode({ ok: false, error: 'ratelimited' })).toEqual({ ok: false, error: 'ratelimited' })
  })
})

describe('ts helpers', () => {
  it('compares as two integers, not as floats', () => {
    expect(compareTs('1760000000.000100', '1760000000.000020')).toBe(1)
    expect(compareTs('1760000000.5', '1760000000.500000')).toBe(0)
    expect(compareTs('1759999999.999999', '1760000000.000000')).toBe(-1)
  })

  it('round trips through milliseconds', () => {
    expect(millisToTs(1760000000123, 7)).toBe('1760000000.123007')
    expect(tsToMillis('1760000000.123007')).toBe(1760000000123)
  })

  it('builds permalinks like the official client', () => {
    expect(permalinkPath('C0ENG', '1760000000.000100')).toBe('/archives/C0ENG/p1760000000000100')
    expect(permalinkPath('C0ENG', '1760000000.000200', '1760000000.000100')).toBe(
      '/archives/C0ENG/p1760000000000200?thread_ts=1760000000.000100&cid=C0ENG',
    )
  })
})
