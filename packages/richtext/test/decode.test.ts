/**
 * A message as Slack sends it, decoded with `@juno/slack-schema` and rendered
 * here. This is the path the engine takes for every real message, so the
 * decoded `Message` must be a `MessageContent` with no cast, and no text the
 * sender wrote may be lost on the way, even in element kinds we do not model.
 */
import { Message } from '@juno/slack-schema'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { messageBody, plainText, previewText, type Lookups, type MessageContent } from '../src/index'

const lookups: Lookups = {
  me: 'U0ME',
  user: (id) => ({ U0ME: 'Tushar', U0MAYA: 'Maya Chen' })[id],
  channel: (id) => ({ C0ENG: 'eng' })[id],
}

/** Shaped after a `conversations.history` message from the official client, with the ids and text replaced. */
const payload = {
  type: 'message',
  user: 'U0MAYA',
  ts: '1760000000.000100',
  client_msg_id: '2b5c1d7e-0000-4000-8000-000000000000',
  text: '<@U0ME> the *staging bill* doubled, see <https://example.com/bill|the invoice> :chart_with_upwards_trend: and the file',
  team: 'T0TEAM',
  blocks: [
    {
      type: 'rich_text',
      block_id: 'Qx3',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            { type: 'user', user_id: 'U0ME' },
            { type: 'text', text: ' the ' },
            { type: 'text', text: 'staging bill', style: { bold: true } },
            { type: 'text', text: ' doubled, see ' },
            { type: 'link', url: 'https://example.com/bill', text: 'the invoice' },
            { type: 'text', text: ' ' },
            { type: 'emoji', name: 'chart_with_upwards_trend', unicode: '1f4c8' },
            { type: 'text', text: ' and the file ' },
            // Element kinds the schema does not model decode to `unknown` with the raw object kept.
            { type: 'file', file_id: 'F0INVOICE', text: 'invoice-october.pdf' },
            { type: 'text', text: ' plus ' },
            { type: 'canvas', canvas_id: 'F0CANVAS', fallback: 'Q4 plan' },
          ],
        },
        { type: 'rich_text_quote', elements: [{ type: 'text', text: 'from the finance thread' }] },
        // A block-level element kind we do not model, with text.
        { type: 'rich_text_table_future', text: 'see the table' },
      ],
    },
    // A whole block kind we do not model, with nothing to render.
    { type: 'actions', block_id: 'act', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Approve' } }] },
  ],
  reactions: [{ name: 'eyes', users: ['U0ME'], count: 1 }],
  brand_new_field: { from: 'a future Slack release' },
}

describe('decode with slack-schema, render with richtext', () => {
  const message = Schema.decodeUnknownSync(Message)(payload)

  it('renders a decoded message with no cast', () => {
    const content: MessageContent = message
    const body = messageBody(content, lookups)
    expect(body.blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'user', id: 'U0ME', name: 'Tushar', isMe: true },
          { kind: 'text', text: ' the ' },
          { kind: 'text', text: 'staging bill', style: { bold: true } },
          { kind: 'text', text: ' doubled, see ' },
          { kind: 'link', url: 'https://example.com/bill', text: 'the invoice' },
          { kind: 'text', text: ' ' },
          { kind: 'emoji', name: 'chart_with_upwards_trend', unicode: '📈' },
          { kind: 'text', text: ' and the file invoice-october.pdf plus Q4 plan' },
        ],
      },
      { kind: 'quote', children: [{ kind: 'text', text: 'from the finance thread' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'see the table' }] },
    ])
  })

  it('keeps the text of unknown elements in previews and plain text', () => {
    const body = messageBody(message, lookups)
    expect(previewText(body)).toBe('@Tushar the staging bill doubled, see the invoice 📈 and the file invoice-october.pdf plus Q4 plan see the table')
    expect(plainText(body)).toContain('invoice-october.pdf')
    expect(plainText(body)).toContain('> from the finance thread')
  })

  it('falls back to mrkdwn text when a decoded message has no renderable blocks', () => {
    const bare = Schema.decodeUnknownSync(Message)({ ts: '1760000000.000200', text: 'plain *bold* text', blocks: [{ type: 'actions', elements: [] }] })
    expect(messageBody(bare, lookups).blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'plain ' },
          { kind: 'text', text: 'bold', style: { bold: true } },
          { kind: 'text', text: ' text' },
        ],
      },
    ])
  })
})
