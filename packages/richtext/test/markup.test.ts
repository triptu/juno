import { describe, expect, it } from 'bun:test'
import { markupLayout, toggleMarkup, type MarkupEdit, type MarkupStyle } from '../src/index'

/** `text` with `[` and `]` around the selection (or one `|` for the caret), after the key's edit. */
function press(marked: string, style: MarkupStyle | 'quote', opaque?: ReadonlyArray<{ readonly start: number; readonly end: number }>): string {
  const caret = marked.indexOf('|')
  const start = caret >= 0 ? caret : marked.indexOf('[')
  const end = caret >= 0 ? caret : marked.indexOf(']') - 1
  const text = marked.replace(/[[\]|]/g, '')
  const edit: MarkupEdit | undefined = toggleMarkup(text, { start, end }, style, opaque)
  if (edit === undefined) return marked
  const after = text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
  const { start: from, end: to } = edit.selection
  return from === to ? `${after.slice(0, from)}|${after.slice(from)}` : `${after.slice(0, from)}[${after.slice(from, to)}]${after.slice(to)}`
}

describe('formatting keys', () => {
  const cases: ReadonlyArray<readonly [string, MarkupStyle | 'quote', string, ReadonlyArray<{ readonly start: number; readonly end: number }>?]> = [
    ['make [this] bold', 'bold', 'make *[this]* bold'],
    ['make *[this]* bold', 'bold', 'make [this] bold'],
    ['make [*this*] bold', 'bold', 'make [this] bold'],
    ['a [word ]here', 'italic', 'a _[word]_ here'],
    ['type |', 'strike', 'type ~|~'],
    ['type ~|~', 'strike', 'type |'],
    ['run [npm test]', 'code', 'run `[npm test]`'],
    ['[one\ntwo]', 'code', '```\n[one\ntwo]\n```'],
    ['```\n[one\ntwo]\n```', 'code', '[one\ntwo]'],
    ['[one\n\ntwo]', 'bold', '[*one*\n\n*two*]'],
    ['[*one*\n*two*]', 'bold', '[one\ntwo]'],
    ['quote |me', 'quote', '> quote |me'],
    ['> quote |me', 'quote', 'quote |me'],
    ['[a\nb\n]c', 'quote', '[> a\n> b]\nc'],
    ['[> a\nb]', 'quote', '[> a\n> b]'],
    // A code block keeps every line's indent and trims only line breaks at the selection's edges.
    ['[  first\n  second]', 'code', '```\n[  first\n  second]\n```'],
    ['[  first\n  second\n]next', 'code', '```\n[  first\n  second]\n```\nnext'],
    ['[\n  first\n  second\n]', 'code', '\n```\n[  first\n  second]\n```\n'],
    ['[  first\n  second] next', 'code', '```\n[  first\n  second]\n```\n next'],
    // Part of a picked name (the opaque range) styles the whole name.
    ['ask @M[ay]a Chen now', 'italic', 'ask _[@Maya Chen]_ now', [{ start: 4, end: 14 }]],
  ]
  for (const [before, style, after, opaque] of cases) {
    it(`${style}: ${JSON.stringify(before)}`, () => expect(press(before, style, opaque)).toBe(after))
  }
})

describe('the field’s look', () => {
  it('marks styled runs, their markers, code blocks and quote lines', () => {
    const text = '*hi* _<@U1>_\n> `x`\n```\ncode\n```'
    const layout = markupLayout(text)
    const slice = (range: { readonly start: number; readonly end: number }) => text.slice(range.start, range.end)
    expect(layout.spans.map((span) => [span.style, slice(span)])).toEqual(expect.arrayContaining([
      ['bold', 'hi'],
      ['italic', '<@U1>'],
      ['code', '`x`'],
      ['code', '```\ncode\n```'],
    ]))
    expect(layout.spans).toHaveLength(4)
    expect(layout.markers.map(slice)).toEqual(['*', '*', '_', '_', '>', '`', '`', '```', '```'])
    expect(layout.quotes.map(slice)).toEqual(['> `x`'])
    expect(layout.codeBlocks.map(slice)).toEqual(['```\ncode\n```'])
  })

  it('reads no markers inside the picked mentions and linked words it is given', () => {
    const text = 'ask @_Maya_ now'
    expect(markupLayout(text, [{ start: 4, end: 11 }]).spans).toEqual([])
    expect(markupLayout(text).spans).toEqual([{ start: 6, end: 10, style: 'italic' }])
  })
})
