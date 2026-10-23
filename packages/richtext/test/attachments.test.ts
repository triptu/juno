import { describe, expect, it } from 'bun:test'
import { Schema } from 'effect'
import { Message } from '@juno/slack-schema'
import { inlinesOf, messageBody, messageTitle, plainText, previewText, type PlaceName } from '../src'

const parse = (content: object) => messageBody(Schema.decodeUnknownSync(Message)({ ts: '1700000000.000000', ...content }))

describe('integration content', () => {
  it.each([
    ['GitHub-like', { title: '#42 Improve cache', text: 'Avoid duplicate requests', color: '36a64f' }, ['#42 Improve cache', 'Avoid duplicate requests']],
    ['Linear-like', { title: 'APP-12 Fix navigation', text: '*Ready* for review', title_link: 'https://example.test/issue/12' }, ['APP-12 Fix navigation', 'Ready for review']],
    ['alert-like', { title: 'Latency increased', fields: [{ title: 'Region', value: 'West' }, { title: 'Severity', value: 'Warning' }], footer: 'Monitor', ts: 1700000000, color: 'warning' }, ['Latency increased', 'Region', 'West', 'Monitor']],
  ])('keeps %s content ahead of boilerplate fallback', (_, attachment, expected) => {
    const body = parse({ attachments: [{ ...attachment, fallback: 'Event notification' }] })
    expect(body.blocks[0]?.kind).toBe('attachment')
    for (const text of expected) {
      expect(plainText(body)).toContain(text)
      expect(previewText(body)).toContain(text)
    }
    expect(plainText(body)).not.toContain('Event notification')
  })

  it('renders section fields, context, images, actions and unknown text', () => {
    const body = parse({ blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Issue* updated' }, fields: [{ type: 'plain_text', text: 'Owner' }, { type: 'mrkdwn', text: 'Team' }] },
      { type: 'context', elements: [{ type: 'plain_text', text: 'Created today' }] },
      { type: 'image', image_url: 'https://example.test/chart.png', alt_text: 'Latency chart' },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View issue' }, url: 'https://example.test/issue' }] },
      { type: 'future', text: 'Still readable' },
    ] })
    expect(body.blocks.map((block) => block.kind)).toEqual(['paragraph', 'fields', 'context', 'image', 'paragraph', 'paragraph'])
    expect(plainText(body)).toContain('Still readable')
    expect(inlinesOf(body)).toContainEqual({ kind: 'link', url: 'https://example.test/issue', text: 'View issue' })
  })

  it('uses a structured title for an integration root', () => {
    expect(messageTitle({ text: '[sample/project] Pull request opened', attachments: [{ title: '#42 Improve cache' }] })).toBe('PR #42: Improve cache')
    expect(messageTitle(Schema.decodeUnknownSync(Message)({ ts: '1700000000.000000', blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Latency alert' } }] }))).toBe('Latency alert')
  })
  it('keeps a meaningful human message ahead of an unfurl title and strips nested quotes in previews', () => {
    expect(messageTitle({ text: 'This issue needs a careful review', attachments: [{ title: 'Unrelated page title' }] })).toMatch(/^This issue needs a careful review/)
    expect(previewText(parse({ attachments: [{ text: '> Quoted detail\nVisible detail' }] }))).toBe('Visible detail')
  })

})

it('keeps unfurl author, text, service icon and source link through decoding', () => {
  const body = parse({ attachments: [{
    title: 'Avery Example on X', from_url: 'https://example.test/post/1',
    author_name: 'Avery Example (@avery_example)', author_icon: 'https://example.test/author.png',
    text: 'Small experiments make the next decision clearer.', service_name: 'X', service_icon: 'https://example.test/x.png',
    image_url: 'https://example.test/chart.png', image_width: 600, image_height: 400,
  }] })
  expect(body.blocks[0]).toMatchObject({
    kind: 'attachment', author: { name: 'Avery Example (@avery_example)', icon: 'https://example.test/author.png' },
    footerIcon: 'https://example.test/x.png', footer: [{ kind: 'text', text: 'X' }],
    title: [{ kind: 'link', url: 'https://example.test/post/1', text: 'Avery Example on X' }],
  })
  expect(plainText(body)).toContain('Small experiments make the next decision clearer.')
})

describe('a shared Slack message', () => {
  const words = 'Can someone look at the staging deploy?'
  const richText = [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: words }] }] }]
  const shared = {
    is_msg_unfurl: true, author_name: 'Maya', author_icon: 'https://example.test/maya.png',
    from_url: 'https://example.test/archives/C0ENG/p1792178160000100', ts: '1792178160.000100',
    footer: 'Thread in Slack conversation', fallback: `[October 16th, 2026 10:26 PM] Maya: ${words}`, text: words, mrkdwn_in: ['text'],
  }
  const count = (text: string) => text.split(words).length - 1

  it('shows its words once when they come as message blocks and text', () => {
    const body = parse({ text: '', attachments: [{ ...shared, message_blocks: [{ team: 'T0', channel: 'C0ENG', ts: shared.ts, message: { blocks: richText } }] }] })
    expect(count(plainText(body))).toBe(1)
    expect(body.blocks[0]).toMatchObject({ kind: 'attachment', author: { name: 'Maya' } })
  })

  it('shows its words once when they come as attachment blocks and text', () => {
    expect(count(plainText(parse({ attachments: [{ ...shared, blocks: richText }] })))).toBe(1)
  })

  it('falls back to the text when it has no blocks', () => {
    expect(count(plainText(parse({ attachments: [shared] })))).toBe(1)
  })

  it("shows the files of a message with no words, never Slack's fallback line", () => {
    const fallback = '[October 19th, 2026 3:23 PM] Maya: demo.mov'
    const { text: _, ...wordless } = shared
    const body = parse({ text: '', attachments: [{ ...wordless, is_share: true, fallback, files: [{ id: 'F0CLIP', name: 'demo.mov', mimetype: 'video/quicktime', original_w: 1280, original_h: 720 }] }] })
    const card = body.blocks[0]
    expect(card?.kind === 'attachment' && card.blocks).toEqual([{ kind: 'file', id: 'F0CLIP', name: 'demo.mov', mimetype: 'video/quicktime', width: 1280, height: 720 }])
    expect(plainText(body)).not.toContain(fallback)
  })
})

describe('where a shared Slack message came from', () => {
  const permalink = 'https://acme.slack.com/archives/C0ENG/p1792178160000100'
  const shared = { is_share: true, is_msg_unfurl: true, author_name: 'Maya', text: 'Ship it', from_url: permalink, ts: '1792178160.000100', footer: 'Thread in Slack conversation' }
  const places: Record<string, PlaceName> = { C0ENG: { kind: 'public', name: 'eng' }, G0OPS: { kind: 'private', name: 'ops' }, D0MAYA: { kind: 'im', name: 'Maya Chen' } }
  const card = (attachment: object) => {
    const block = messageBody(Schema.decodeUnknownSync(Message)({ ts: '1792178200.000000', text: '', attachments: [attachment] }), { place: (id) => places[id] }).blocks[0]
    if (block?.kind !== 'attachment') throw new Error('expected an attachment')
    return block
  }
  const date = { kind: 'date', timestamp: 1792178160.0001, format: '{date_short} at {time}', fallback: '' }

  it('names the channel Juno knows, links to the message, and keeps only the date in the footer', () => {
    const block = card(shared)
    expect(block.source).toEqual({ kind: 'public', name: 'eng', url: permalink, thread: false })
    expect(block.footer).toEqual([date])
  })

  it('says a reply was in a thread', () => {
    const reply = `https://acme.slack.com/archives/C0ENG/p1792178160000100?thread_ts=1792178000.000050&cid=C0ENG`
    expect(card({ ...shared, from_url: reply }).source).toMatchObject({ name: 'eng', thread: true })
    // A link to a thread's root carries its own ts: not a reply.
    expect(card({ ...shared, from_url: `${permalink}?thread_ts=1792178160.000100&cid=C0ENG` }).source).toMatchObject({ thread: false })
  })

  it('takes the conversation from channel_id, so a private channel or a DM is named as Juno names it', () => {
    expect(card({ ...shared, channel_id: 'G0OPS', from_url: 'https://acme.slack.com/archives/G0OPS/p1792178160000100' }).source).toMatchObject({ kind: 'private', name: 'ops' })
    expect(card({ ...shared, channel_id: 'D0MAYA' }).source).toMatchObject({ kind: 'im', name: 'Maya Chen' })
  })

  it("keeps Slack's footer, as a link to the message, for a place Juno does not know", () => {
    const block = card({ ...shared, channel_id: 'C0ELSEWHERE' })
    expect(block.source).toBeUndefined()
    expect(block.footer).toEqual([{ kind: 'link', url: permalink, text: 'Thread in Slack conversation' }, { kind: 'text', text: ' · ' }, date])
    expect(card({ ...shared, channel_id: 'C0ELSEWHERE', footer: '', channel_name: 'launch' }).footer[0]).toEqual({ kind: 'link', url: permalink, text: '#launch' })
  })

  it('leaves other attachments as Slack sent them', () => {
    const block = card({ title: 'Planning notes', from_url: 'https://example.test/archives/C0ENG/p1792178160000100', footer: 'Docs' })
    expect(block.source).toBeUndefined()
    expect(block.footer).toEqual([{ kind: 'text', text: 'Docs' }])
  })
})
