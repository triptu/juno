import { describe, expect, it } from 'bun:test'
import { bodyFromMarkdown } from '../src/index'

describe('markdown files', () => {
  it('reads headings, paragraphs, lists, quotes, code and rules', () => {
    const body = bodyFromMarkdown(['# Release 4.2', '', 'Ships on **Monday**, see [the plan](https://example.com/plan).', 'Second line.', '', '- one', '- two', '', '1. first', '', '- [x] done', '', '> quoted', '', '```ts', 'const a = 1', '```', '', '---', 'Setext', '===='].join('\n'))
    expect(body.blocks).toEqual([
      { kind: 'heading', children: [{ kind: 'text', text: 'Release 4.2' }] },
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Ships on ' },
          { kind: 'text', text: 'Monday', style: { bold: true } },
          { kind: 'text', text: ', see ' },
          { kind: 'link', url: 'https://example.com/plan', text: 'the plan' },
          { kind: 'text', text: '. Second line.' },
        ],
      },
      { kind: 'list', style: 'bullet', indent: 0, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
      { kind: 'list', style: 'ordered', indent: 0, items: [[{ kind: 'text', text: 'first' }]] },
      { kind: 'list', style: 'checked', indent: 0, items: [[{ kind: 'text', text: 'done' }]] },
      { kind: 'quote', children: [{ kind: 'text', text: 'quoted' }] },
      { kind: 'code', text: 'const a = 1', language: 'ts' },
      { kind: 'divider' },
      { kind: 'heading', children: [{ kind: 'text', text: 'Setext' }] },
    ])
  })

  it('keeps snake_case words and lone markers as text, and reads inline code before emphasis', () => {
    expect(bodyFromMarkdown('use snake_case_name and 2 * 3 * 4, or `*not em*`').blocks).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'use snake_case_name and 2 * 3 * 4, or ' }, { kind: 'text', text: '*not em*', style: { code: true } }] },
    ])
  })

  it('turns an image into a link to it, so nothing is fetched', () => {
    expect(bodyFromMarkdown('![chart](https://example.com/c.png)').blocks).toEqual([{ kind: 'paragraph', children: [{ kind: 'link', url: 'https://example.com/c.png', text: 'chart' }] }])
  })
})

describe('markdown files that never close what they open', () => {
  it.each([
    ['brackets', '['],
    ['links without a target', '[a]('],
    ['autolinks', '<http://a'],
    ['backticks', '`a'],
    ['emphasis', '**a '],
    ['underscores', '_a '],
  ])('reads 200 KB of unclosed %s in well under a second', (_, unit) => {
    const text = unit.repeat(Math.ceil(200_000 / unit.length))
    const started = Date.now()
    const body = bodyFromMarkdown(text)
    expect(Date.now() - started).toBeLessThan(500)
    expect(body.blocks).toHaveLength(1)
  })
})
