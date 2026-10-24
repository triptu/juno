import type { SearchGroup, SearchHit, SearchTitleHit } from '@juno/contract'
import { compareTs, searchRanges, type SearchQuery } from '@juno/domain'

export interface Coverage { readonly through: string | null; readonly complete: boolean }
export interface SearchPage { readonly rows: ReadonlyArray<SearchHit>; readonly coverage: Coverage }
const compare = compareTs

/** Window around the first literal match, starting at a word a few words before it. Offsets always address the returned text. */
export function searchSnippet(text: string, ranges: ReadonlyArray<{ start: number; end: number }>, max = 220) {
  const first = ranges[0]
  const lead = Math.max(0, (first?.start ?? 0) - 45)
  const space = lead === 0 ? -1 : text.indexOf(' ', lead)
  const start = space >= 0 && space < (first?.start ?? 0) ? space + 1 : lead
  const end = Math.min(text.length, Math.max(start + max, first?.end ?? 0))
  const prefix = start > 0 ? '…' : ''
  return { text: prefix + text.slice(start, end) + (end < text.length ? '…' : ''), ranges: ranges.filter((r) => r.start >= start && r.end <= end).map((r) => ({ start: r.start - start + prefix.length, end: r.end - start + prefix.length })) }
}
export function literalRanges(text: string, query: SearchQuery) {
  return searchRanges(text, query.clauses.flatMap((clause) => (clause.kind === 'term' || clause.kind === 'phrase') && !clause.negated ? [clause.value] : []))
}

/**
 * Coverage follows raw source pages, before hidden rows are removed. Local copies win dedupe.
 * Flat (the default) gives each match and each title-only topic a group of its own, in time order, so a later
 * page only adds rows at the end. `group` gathers a thread's matches under its newest, and consecutive Main
 * matches from one channel.
 */
export function mergeSearch(input: {
  readonly local: ReadonlyArray<SearchHit>
  readonly titles: ReadonlyArray<SearchTitleHit>
  readonly localCoverage: Coverage
  readonly pages: ReadonlyArray<SearchPage>
  readonly sort: 'newest' | 'oldest'
  readonly establishedTitles?: ReadonlySet<string>
  readonly group?: boolean
}): { groups: ReadonlyArray<SearchGroup>; frontier: { through: string | null; complete: boolean; olderGroupIndex: number } } {
  const direction = input.sort === 'newest' ? -1 : 1
  const slack = input.pages.at(-1)?.coverage ?? { through: null, complete: false }
  const sources = [input.localCoverage, slack].filter((source) => !source.complete)
  const complete = sources.length === 0
  const through = sources.some((s) => s.through === null) ? null : sources.map((s) => s.through).filter((s): s is string => s !== null).sort((a, b) => direction * compare(a, b))[0] ?? null
  const older = (ts: string) => !complete && (through === null || direction * compare(ts, through) > 0)
  const rows = new Map<string, SearchHit>()
  for (const row of [...input.pages.flatMap((p) => p.rows), ...input.local]) rows.set(`${row.place.id}:${row.ts}`, row)
  const titles = new Map(input.titles.map((title) => [title.id, title]))
  type Entry = { kind: 'message'; at: string; row: SearchHit } | { kind: 'title'; at: string; row: SearchTitleHit }
  const entries: Entry[] = [...rows.values()].map((row) => ({ kind: 'message', at: row.ts, row }))
  const matchedTopics = new Set([...rows.values()].map((row) => row.topicId))
  for (const row of input.titles) if (!matchedTopics.has(row.id) || input.establishedTitles?.has(row.id)) entries.push({ kind: 'title', at: (row.at / 1000).toFixed(6), row })
  entries.sort((a, b) => direction * compare(a.at, b.at) || a.row.id.localeCompare(b.row.id))
  const groups: SearchGroup[] = []
  const threads = new Map<string, number>()
  for (const entry of entries) {
    const isOlder = older(entry.at)
    const topicId = entry.kind === 'message' ? entry.row.topicId : entry.row.id
    const kind = entry.kind === 'title' ? 'topic' : topicId.startsWith('t:') ? 'thread' : 'main'
    const key = `${isOlder ? 'older:' : ''}${topicId}`
    const previous = groups.at(-1)
    const index = input.group !== true ? undefined : kind === 'thread' ? threads.get(key) : kind === 'main' && previous?.kind === 'main' && previous.place.id === entry.row.place.id && previous.older === isOlder ? groups.length - 1 : undefined
    const title = titles.get(topicId)
    if (index !== undefined && entry.kind === 'message') {
      const group = groups[index]
      if (group !== undefined) groups[index] = { ...group, messages: [...group.messages, entry.row], matchCount: group.matchCount + 1 }
    } else {
      if (kind === 'thread') threads.set(key, groups.length)
      const art = title?.art ?? entry.row.art
      groups.push({ id: kind === 'main' || (input.group !== true && entry.kind === 'message') ? `${key}:${entry.row.id}` : key, kind, topicId, title: title?.title ?? entry.row.title, titleRanges: title?.ranges ?? [], place: entry.row.place, ...(art === undefined ? {} : { art }), at: entry.at, messages: entry.kind === 'message' ? [entry.row] : [], older: isOlder, matchCount: entry.kind === 'message' ? 1 : 0 })
    }
  }
  const index = groups.findIndex((g) => g.older)
  return { groups, frontier: { through, complete, olderGroupIndex: index < 0 ? groups.length : index } }
}

/** At most count snippets cross IPC, even when a whole page belongs to one thread or Main. */
export function windowSearchGroups(groups: ReadonlyArray<SearchGroup>, offset: number, count: number) {
  let at = 0
  const visible: SearchGroup[] = []
  for (const group of groups) {
    const length = Math.max(1, group.messages.length)
    if (at < offset + count && at + length > offset) visible.push({ ...group, messages: group.messages.slice(Math.max(0, offset - at), Math.max(0, offset + count - at)) })
    at += length
  }
  return { groups: visible, totalRows: at }
}
