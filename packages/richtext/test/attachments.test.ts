import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { Message } from '@juno/slack-schema'
import { inlinesOf, messageBody, messageTitle, plainText, previewText } from '../src'

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
