import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { parseSearchQuery, printSearchQuery, SearchQuery, searchDateBounds } from '../src/search-query'

test('operators, quoted phrases and escaped quotes survive chip copy and reparsing', () => {
  const raw = 'rollout "the \\"big\\" launch" -obsolete from:"Maya Chen" in:<#C1> in:#eng -from:<@U2> -in:#alerts after:2026-10-01 during:2026-10 has:link has::eyes: is:thread'
  const parsed = Schema.decodeUnknownSync(SearchQuery)(parseSearchQuery(raw))
  expect(parsed.diagnostics).toEqual([])
  const roundTrip = parseSearchQuery(printSearchQuery(parsed))
  expect(roundTrip.clauses).toEqual(parsed.clauses)
  expect(parsed.scope).toEqual({ hideApps: true, hideAutomated: true, sort: 'newest' })
  for (const clause of parsed.clauses) expect(raw.slice(clause.span.start, clause.span.end)).not.toBe('')
})

test('unfinished filters and quotes keep source spans, while unsupported syntax is diagnosed', () => {
  for (const text of ['from:', '"part of a phrase', '-', 'after:2026-10-']) {
    const query = parseSearchQuery(text)
    expect(query.clauses[0]).toMatchObject({ kind: 'incomplete', text, span: { start: 0, end: text.length } })
    expect(printSearchQuery(query)).toBe(text)
  }
  const query = parseSearchQuery('with:maya is:saved word* unknown:value before:2026-02-30')
  expect(query.diagnostics.map((d) => d.code)).toEqual(['unsupported', 'unsupported', 'unsupported', 'unsupported', 'invalid'])
  expect(parseSearchQuery('"from:me"').clauses[0]).toMatchObject({ kind: 'phrase', value: 'from:me' })
})

test('date intervals exclude named after/before days and follow calendar DST boundaries', () => {
  const bounds = (text: string, zone: string) => {
    const clause = parseSearchQuery(text).clauses[0]
    if (clause?.kind !== 'date') throw new Error('Expected a date clause')
    return searchDateBounds(clause, zone)
  }
  expect(bounds('on:2026-10-01', 'Asia/Kolkata')).toEqual({ from: Date.parse('2026-09-30T18:30:00Z') / 1000, to: Date.parse('2026-10-01T18:30:00Z') / 1000 })
  expect(bounds('after:2026-10-01', 'Asia/Kolkata').from).toBe(bounds('on:2026-10-01', 'Asia/Kolkata').to)
  expect(bounds('before:2026-10-01', 'Asia/Kolkata').to).toBe(bounds('on:2026-10-01', 'Asia/Kolkata').from)
  const spring = bounds('on:2026-03-08', 'America/New_York')
  expect((spring.to ?? 0) - (spring.from ?? 0)).toBe(23 * 3600)
  const fall = bounds('on:2026-11-01', 'America/New_York')
  expect((fall.to ?? 0) - (fall.from ?? 0)).toBe(25 * 3600)
  expect(bounds('during:2026-12', 'UTC')).toEqual({ from: Date.parse('2026-12-01') / 1000, to: Date.parse('2027-01-01') / 1000 })
})
