import { expect, test } from 'bun:test'
import { parseSearchQuery } from '@juno/domain'
import type { SearchHit, SearchTitleHit } from '@juno/contract'
import { literalRanges, mergeSearch, searchSnippet } from '../src/search/merge'

const place = { id: 'C1', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'hash', color: 'jordy' } as const
const hit = (ts: number, thread = false, channel = 'C1'): SearchHit => ({ kind: 'message', id: `${channel}:${ts}`, ts: `${ts}.000000`, topicId: thread ? `t:${channel}:10` : `m:${channel}`, title: 'Launch', text: 'launch found', sender: 'Maya', place: { ...place, id: channel }, stored: true, ranges: [{ start: 0, end: 6 }] })

test('frontier, dedupe and thread grouping remain stable as pages reach older local matches', () => {
  const local = [hit(95, true), hit(30), hit(20)]
  const base = { local, titles: [], localCoverage: { through: null, complete: true }, sort: 'newest' as const, group: true }
  const firstPage = { rows: [hit(100), { ...hit(95, true), stored: false }, hit(90), hit(80, true)], coverage: { through: '80.000000', complete: false } }
  const first = mergeSearch({ ...base, pages: [firstPage] })
  expect(first.frontier).toEqual({ through: '80.000000', complete: false, olderGroupIndex: 3 })
  expect(first.groups.flatMap((g) => g.messages).filter((r) => r.ts === '95.000000')).toEqual([hit(95, true)])
  expect(first.groups[1]?.messages.map((r) => r.ts)).toEqual(['95.000000', '80.000000'])
  const later = mergeSearch({ ...base, pages: [firstPage, { rows: [hit(70, true), hit(60), hit(30)], coverage: { through: '30.000000', complete: false } }] })
  expect(later.groups.slice(0, 3).map((g) => g.id)).toEqual(first.groups.slice(0, 3).map((g) => g.id))
  expect(later.groups[1]?.messages.map((r) => r.ts)).toEqual(['95.000000', '80.000000', '70.000000'])
  expect(later.groups.flatMap((g) => g.messages).filter((r) => r.ts === '30.000000')).toHaveLength(1)
  expect(later.groups.at(-1)?.older).toBe(true)
  const done = mergeSearch({ ...base, pages: [firstPage, { rows: [hit(20)], coverage: { through: '20.000000', complete: true } }] })
  expect(done.frontier.complete).toBe(true)
  expect(done.groups.every((g) => !g.older)).toBe(true)

  // Flat, the default: one row per match in time order, and a later page only adds rows after the established ones.
  const flatFirst = mergeSearch({ ...base, group: false, pages: [firstPage] })
  const flatLater = mergeSearch({ ...base, group: false, pages: [firstPage, { rows: [hit(70, true), hit(60), hit(30)], coverage: { through: '30.000000', complete: false } }] })
  const shown = flatFirst.groups.filter((g) => !g.older).map((g) => g.id)
  expect(flatFirst.groups.every((g) => g.messages.length === 1)).toBe(true)
  expect(flatLater.groups.slice(0, shown.length).map((g) => g.id)).toEqual(shown)
  expect(flatLater.groups.map((g) => g.messages[0]?.ts)).toEqual(['100.000000', '95.000000', '90.000000', '80.000000', '70.000000', '60.000000', '30.000000', '20.000000'])
})

test('Main headers only join consecutive rows, title-only results stay topics and oldest reverses coverage', () => {
  const title: SearchTitleHit = { kind: 'topic', id: 't:C1:40', title: 'Launch expenses', at: 40_000, place, ranges: [{ start: 0, end: 6 }] }
  const merged = mergeSearch({ local: [hit(10), hit(20), hit(30, false, 'C2'), hit(50)], titles: [title], localCoverage: { through: null, complete: true }, pages: [{ rows: [], coverage: { through: '30.000000', complete: false } }], sort: 'oldest', group: true })
  expect(merged.groups[0]?.messages.map((r) => r.ts)).toEqual(['10.000000', '20.000000'])
  expect(merged.groups.map((g) => g.kind)).toEqual(['main', 'main', 'topic', 'main'])
  expect(merged.frontier.olderGroupIndex).toBe(2)
  const text = 'Long introduction. '.repeat(50) + 'launch expenses and more'
  const snippet = searchSnippet(text, literalRanges(text, parseSearchQuery('"launch expenses"')))
  // It starts at a whole word, a few words before the match.
  expect(snippet.text.startsWith('…introduction.') || snippet.text.startsWith('…Long')).toBe(true)
  const range = snippet.ranges[0]
  expect(snippet.text.slice(range?.start, range?.end)).toBe('launch expenses')
})
