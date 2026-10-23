import { describe, expect, it } from 'bun:test'
import { findLinks, linkOf } from '../src/index'

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
