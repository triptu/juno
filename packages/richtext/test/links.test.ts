import { describe, expect, it } from 'bun:test'
import { composeOutgoing, findLinks, linkOf, messageBody } from '../src/index'

const section = (text: string, targets?: Parameters<typeof composeOutgoing>[1]) => composeOutgoing(text, targets).blocks[0]?.elements[0]

describe('finding links in text', () => {
  it.each([
    ['see https://slack.com/help.', [['https://slack.com/help', 'https://slack.com/help']]],
    ['see example.com and docs.example.io/a?b=1', [['http://example.com', 'example.com'], ['http://docs.example.io/a?b=1', 'docs.example.io/a?b=1']]],
    ['(https://en.wikipedia.org/wiki/Foo_(bar)) done', [['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)']]],
    ['mail ana@example.com today', [['mailto:ana@example.com', 'ana@example.com']]],
    ['www.example.org/path, then', [['http://www.example.org/path', 'www.example.org/path']]],
  ])('links %j', (text, links) => {
    expect(findLinks(text).map((link) => [link.url, link.text])).toEqual(links)
  })

  it.each(['index.ts and v1.2.3', 'example.community', 'https://', 'a/b.com', 'node.js'])('leaves %j plain', (text) => {
    expect(findLinks(text)).toEqual([])
  })

  it('knows a paste that is one link, and one that is not', () => {
    expect(linkOf(' https://example.com/docs ')).toBe('https://example.com/docs')
    expect(linkOf('example.com')).toBe('http://example.com')
    expect(linkOf('see https://example.com')).toBeUndefined()
  })
})

describe('sending links as Slack does', () => {
  it('sends a URL with its scheme as a link with no text, and a domain with its text', () => {
    const out = composeOutgoing('see example.com and https://slack.com/help')
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'see ' },
        { type: 'link', url: 'http://example.com', text: 'example.com' },
        { type: 'text', text: ' and ' },
        { type: 'link', url: 'https://slack.com/help' },
      ],
    })
    expect(out.text).toBe('see <http://example.com|example.com> and <https://slack.com/help>')
  })

  it('sends a link put on some words with that text, and escapes it in the fallback', () => {
    expect(section('read <https://example.com/a?b=1&c=2|the docs &amp; notes> first')).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'read ' },
        { type: 'link', url: 'https://example.com/a?b=1&c=2', text: 'the docs & notes' },
        { type: 'text', text: ' first' },
      ],
    })
    expect(composeOutgoing('<https://example.com|a &gt; b>').text).toBe('<https://example.com|a &gt; b>')
  })

  it('does not take a mention or an emoji out of a URL', () => {
    const out = composeOutgoing('https://example.com/@Maya/:tada:/x', { people: [{ id: 'U0MAYA', name: 'Maya' }] })
    expect(out.blocks[0]?.elements[0]).toEqual({ type: 'rich_text_section', elements: [{ type: 'link', url: 'https://example.com/@Maya/:tada:/x' }] })
  })

  it('links an edited message’s labelled words again', () => {
    expect(section('see the docs now', { links: [{ text: 'the docs', url: 'https://example.com/docs' }] })).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'see ' },
        { type: 'link', url: 'https://example.com/docs', text: 'the docs' },
        { type: 'text', text: ' now' },
      ],
    })
  })
})

describe('showing links', () => {
  it('shows what Juno sends as links, label and all', () => {
    const sent = composeOutgoing('see example.com and <https://example.com/docs|the docs>')
    expect(messageBody({ text: sent.text, blocks: sent.blocks }).blocks).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'see ' },
          { kind: 'link', url: 'http://example.com', text: 'example.com' },
          { kind: 'text', text: ' and ' },
          { kind: 'link', url: 'https://example.com/docs', text: 'the docs' },
        ],
      },
    ])
  })

  it('links a URL a text element holds, but not in code', () => {
    const body = messageBody({
      blocks: [
        {
          type: 'rich_text',
          elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'at https://example.com ' }, { type: 'text', text: 'example.com', style: { code: true } }] }],
        },
      ],
    })
    expect(body.blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'at ' },
        { kind: 'link', url: 'https://example.com', text: 'https://example.com' },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'example.com', style: { code: true } },
      ],
    })
  })

  it('shows a received <url|label> by its label', () => {
    expect(messageBody({ text: 'read <https://example.com/a?b=1&amp;c=2|the docs>' }).blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'read ' },
        { kind: 'link', url: 'https://example.com/a?b=1&c=2', text: 'the docs' },
      ],
    })
  })
})
