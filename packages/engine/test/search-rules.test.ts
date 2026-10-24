import { expect, test } from 'bun:test'
import { parseSearchQuery } from '@juno/domain'
import type { SearchHit, SearchTitleHit } from '@juno/contract'
import { compileSearchSlack, compileSearchSql, type ResolvedSearch } from '../src/searchCompiler'
import { literalRanges, mergeSearch, searchSnippet } from '../src/search/merge'

const resolved = (text: string): ResolvedSearch => {
  const query = parseSearchQuery(text, { timeZone: 'Asia/Kolkata' })
  return { query, timeZone: 'Asia/Kolkata', identities: new Map(query.clauses.flatMap((c) => c.kind === 'identity' ? [[c.span.start, [{ id: c.value, slack: `<${c.operator === 'in' ? '#' : '@'}${c.value}>` }]]] : [])) }
}
test('compilers bind terms and filters and preserve OR channels, exclusions, calendar bounds and bot hiding', () => {
  const search = resolved('"rollout plan" -obsolete in:C1 in:C2 -in:C3 from:U1 -from:U2 after:2026-10-01 before:2026-11-01 has:link has:file has:reaction has::eyes: is:thread')
  const sql = compileSearchSql(search)
  expect(sql.source).toContain('messages_fts')
  expect(sql.where).toContain('m.channel IN (?, ?)')
  expect(sql.where).toContain('m.channel NOT IN (?)')
  expect(sql.where).toContain('json_tree')
  expect(sql.where).toContain('reactions')
  expect(sql.where).not.toContain('rollout')
  expect(sql.params).toContain('"rollout plan"')
  expect(sql.params).toContain(String(Date.parse('2026-10-01T18:30:00Z') / 1000) + '.000000')
  expect(sql.params).toContain('eyes')
  expect(compileSearchSlack(search, 2)).toMatchObject({ query: '"rollout plan" -"obsolete" in:<#C1> in:<#C2> -in:<#C3> from:<@U1> -from:<@U2> after:2026-10-01 before:2026-11-01 has:link has:file has:reaction has::eyes: is:thread', query_rewrite_disabled: true, search_exclude_bots: true, count: 50, page: 2, sort: 'timestamp', sort_dir: 'desc', highlight: 1, extracts: 1, extra_message_data: 1 })
  const title = compileSearchSql(search, { titles: true })
  expect(title.where).toContain('p.user_id IN (?)')
  expect(title.where).toContain('i.last_activity_ts >= ?')
  expect(title.where).toContain('i.channel IN (?, ?)')
  expect(title.source).toContain('overlay_titles_fts')
})

test('negative-only, unresolved, unsupported, Slack-only pins and topic scopes cannot broaden local search', () => {
  expect(compileSearchSql(resolved('-obsolete')).source).not.toContain('JOIN messages')
  expect(compileSearchSql(resolved('-obsolete')).where).toContain('m.rowid NOT IN')
  const unresolved = { ...resolved('from:missing'), identities: new Map() }
  expect(compileSearchSql(unresolved).where).toContain('0 = 1')
  expect(compileSearchSlack(unresolved)).toBeUndefined()
  expect(compileSearchSlack(resolved('is:saved'))).toBeUndefined()
  expect(compileSearchSql(resolved('has:pin'))).toMatchObject({ needsSlack: true })
  expect(compileSearchSql(resolved('has:pin')).where).toContain('0 = 1')
  expect(compileSearchSlack(resolved('has:pin'))?.query).toBe('has:pin')
  const search = resolved('launch')
  const scoped = { ...search, query: { ...search.query, scope: { ...search.query.scope, topic: { channel: 'C1', threadTs: '100.000001' } } } }
  expect(compileSearchSql(scoped).params.slice(-3)).toEqual(['C1', '100.000001', '100.000001'])
  expect(compileSearchSlack(scoped)?.query).toBe('"launch" in:<#C1>')
})

const place = { id: 'C1', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'hash', color: 'jordy' } as const
const hit = (ts: number, thread = false, channel = 'C1'): SearchHit => ({ kind: 'message', id: `${channel}:${ts}`, ts: `${ts}.000000`, topicId: thread ? `t:${channel}:10` : `m:${channel}`, title: 'Launch', text: 'launch found', sender: 'Maya', place: { ...place, id: channel }, stored: true, ranges: [{ start: 0, end: 6 }] })

test('frontier, dedupe and thread grouping remain stable as pages reach older local matches', () => {
  const local = [hit(95, true), hit(30), hit(20)]
  const base = { local, titles: [], localCoverage: { through: null, complete: true }, sort: 'newest' as const }
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
})

test('Main headers only join consecutive rows, title-only results stay topics and oldest reverses coverage', () => {
  const title: SearchTitleHit = { kind: 'topic', id: 't:C1:40', title: 'Launch expenses', at: 40_000, place, ranges: [{ start: 0, end: 6 }] }
  const merged = mergeSearch({ local: [hit(10), hit(20), hit(30, false, 'C2'), hit(50)], titles: [title], localCoverage: { through: null, complete: true }, pages: [{ rows: [], coverage: { through: '30.000000', complete: false } }], sort: 'oldest' })
  expect(merged.groups[0]?.messages.map((r) => r.ts)).toEqual(['10.000000', '20.000000'])
  expect(merged.groups.map((g) => g.kind)).toEqual(['main', 'main', 'topic', 'main'])
  expect(merged.frontier.olderGroupIndex).toBe(2)
  const text = 'Long introduction. '.repeat(50) + 'launch expenses and more'
  const snippet = searchSnippet(text, literalRanges(text, parseSearchQuery('"launch expenses"')))
  expect(snippet.text.startsWith('…')).toBe(true)
  const range = snippet.ranges[0]
  expect(snippet.text.slice(range?.start, range?.end)).toBe('launch expenses')
})
