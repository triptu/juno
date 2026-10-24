import { expect, test } from 'bun:test'
import { searchRanges } from '../src/search-ranges'

test('normalized matches retain original UTF-16 boundaries through folds, accents and emoji', () => {
  for (const [text, word, matched] of [
    ['İ launch', 'launch', 'launch'],
    ['İ launch', 'i', 'İ'],
    ['cafe\u0301', 'café', 'cafe\u0301'],
    ['café', 'cafe', 'café'],
    ['🚀 café launch', 'launch', 'launch'],
    ['İ 🚀 cafe\u0301', 'cafe', 'cafe\u0301'],
  ] as const) {
    const ranges = searchRanges(text, [word])
    expect(ranges).toHaveLength(1)
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([matched])
    expect(ranges.every(({ start, end }) => start >= 0 && end <= text.length)).toBe(true)
  }
  expect(searchRanges('café café', ['cafe', 'afé'])).toEqual([{ start: 0, end: 4 }, { start: 5, end: 9 }])
  expect(searchRanges('hello', ['', '\u0301'])).toEqual([])
})
