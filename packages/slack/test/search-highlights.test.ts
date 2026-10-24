import { expect, test } from 'bun:test'
import { decodeSearchHighlights } from '../src/client/search-highlights'

test('decodes highlight wrappers to UTF-16 ranges without losing Unicode or adjacent matches', () => {
  for (const [open, close] of [['\uE000', '\uE001'], ['<em>', '</em>'], ['<mark>', '</mark>'], ['<b>', '</b>']]) {
    expect(decodeSearchHighlights(`👋 ${open}café${close} ${open}launch${close}!`)).toEqual({ text: '👋 café launch!', ranges: [{ start: 3, end: 7 }, { start: 8, end: 14 }] })
  }
  expect(decodeSearchHighlights('plain \uE123 text')).toEqual({ text: 'plain \uE123 text', ranges: [] })
  expect(decodeSearchHighlights('<em>unfinished')).toEqual({ text: 'unfinished', ranges: [{ start: 0, end: 10 }] })
  expect(decodeSearchHighlights('<em>a<b>b</b>c</em>')).toEqual({ text: 'abc', ranges: [{ start: 0, end: 3 }] })
})
