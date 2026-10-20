import { expect, it } from 'vitest'
import type { RichTextElement, RichTextInline, RichTextBlock } from '@juno/slack-schema'
import { composeEdit, composeOutgoing, editMarkup } from '../src/index'

const shapes: ReadonlyArray<RichTextElement> = [
  { type: 'rich_text_section', elements: [{ type: 'text', text: '*literal*' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar', style: { bold: true } }, { type: 'text', text: 'baz' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: 'a` b', style: { code: true } }] },
  { type: 'rich_text_preformatted', border: 0, elements: [{ type: 'text', text: 'a```b\n  c' }] },
  { type: 'rich_text_section', elements: [{ type: 'text', text: ' bold ', style: { bold: true } }, { type: 'user', user_id: 'U0MAYA', style: { italic: true } }, { type: 'link', text: 'plan', url: 'https://example.com', style: { code: true } }] },
  { type: 'rich_text_quote', elements: [{ type: 'text', text: 'quoted\nline', style: { strike: true } }] },
  { type: 'rich_text_list', style: 'ordered', indent: 1, elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'item' }] }] },
  { type: 'rich_text_section', elements: [{ type: 'date', timestamp: 1700000000, format: '{date_short}', fallback: 'Nov 14' }, { type: 'emoji', name: 'rocket', unicode: '1f680' }] },
]
const lookups = { user: () => 'Maya Chen' }
for (const [index, shape] of shapes.entries()) {
  it(`preserves Slack shape ${index} when punctuation changes elsewhere`, () => {
    const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [shape, { type: 'rich_text_section', elements: [{ type: 'text', text: 'end' }] }] }]
    const original = { blocks }
    expect(composeEdit(editMarkup(original, lookups) + '!', original, lookups).blocks[0]?.elements[0]).toEqual(shape)
  })
}
for (const [index, shape] of shapes.entries()) {
  it(`parses changed Slack paragraph ${index} as new markup`, () => {
    const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [shape] }]
    const input = editMarkup({ blocks }, lookups) + '!'
    expect(composeEdit(input, { blocks }, lookups).blocks).toEqual(composeOutgoing(input).blocks)
  })
}
it('round trips generated Slack blocks including styles markup cannot express', () => {
  let seed = 811
  const next = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
  const texts = ['*literal*', 'foo', '  ', 'a` b', '```', 'שלום', '𠮷', 'line\nbreak', '\\', ':rocket:', 'https://example.com']
  for (let run = 0; run < 150; run++) {
    const elements: RichTextInline[] = Array.from({ length: 1 + next(8) }, () => ({ type: 'text', text: texts[next(texts.length)]!, style: { bold: next(2) === 1, italic: next(2) === 1, code: next(2) === 1 } }))
    const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements }, shapes[next(shapes.length)]!] }]
    expect(composeEdit(editMarkup({ blocks }, lookups), { blocks }, lookups).blocks).toEqual(blocks)
    const changed = editMarkup({ blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements }] }] }, lookups) + '!'
    expect(composeEdit(changed, { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements }] }] }, lookups).blocks).toEqual(composeOutgoing(changed).blocks)
    const withTrailer: RichTextBlock[] = [{ type: 'rich_text', elements: [...blocks[0]!.elements, { type: 'rich_text_section', elements: [{ type: 'text', text: 'trailer' }] }] }]
    const edited = composeEdit(editMarkup({ blocks: withTrailer }, lookups) + '!', { blocks: withTrailer }, lookups)
    expect(edited.blocks[0]?.elements.slice(0, -1)).toEqual(blocks[0]!.elements)
  }
})

it('reparses the whole paragraph when both ends change', () => {
  const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [shapes[1]!] }]
  expect(composeEdit('Foo*bar*baZ', { blocks }).blocks).toEqual(composeOutgoing('Foo*bar*baZ').blocks)
})
it('keeps an unchanged Slack paragraph between two changed paragraphs', () => {
  const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [
    { type: 'rich_text_section', elements: [{ type: 'text', text: 'before' }] }, shapes[6]!,
    { type: 'rich_text_section', elements: [{ type: 'text', text: 'after' }] },
  ] }]
  expect(composeEdit('Before\nitem\nAfter', { blocks }).blocks[0]?.elements[1]).toEqual(shapes[6])
})

it('keeps punctuation typed at a quote’s end in that quote', () => {
  const original = { blocks: [{ type: 'rich_text' as const, elements: [{ type: 'rich_text_quote' as const, elements: [{ type: 'text' as const, text: 'quoted' }] }] }] }
  expect(composeEdit('> quoted!', original).blocks[0]?.elements).toEqual([{ type: 'rich_text_quote', elements: [{ type: 'text', text: 'quoted!' }] }])
})
