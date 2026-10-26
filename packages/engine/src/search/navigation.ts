import type { SearchNavigation } from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { compileSearchSql, type ResolvedSearch } from '../searchCompiler'

export const emptyNavigation: SearchNavigation = { count: 0, index: 0, previous: null, next: null, marked: [] }

interface Topic { channel: string; root_ts: string | null; kind: string }
interface Position { ts?: string; first?: string; last?: string }

export function searchNavigationStatements(search: ResolvedSearch, topic: Topic, input: Position) {
  const compiled = compileSearchSql(search)
  const topicWhere = topic.kind === 'thread' ? '(m.ts = ? OR m.thread_ts = ?)' : '(m.thread_ts IS NULL OR m.thread_ts = m.ts)'
  const params = [...compiled.params, topic.channel, ...(topic.kind === 'thread' ? [topic.root_ts ?? '', topic.root_ts ?? ''] : [])]
  const where = `${compiled.where} AND m.channel = ? AND ${topicWhere}`
  const ts = input.ts ?? ''
  return {
    summary: {
      sql: `SELECT COUNT(*) AS count, COALESCE(SUM(m.ts <= ?), 0) AS "index", MAX(CASE WHEN m.ts < ? THEN m.ts END) AS previous, MIN(CASE WHEN m.ts > ? THEN m.ts END) AS next FROM ${compiled.source} WHERE ${where}`,
      params: [ts, ts, ts, ...params],
    },
    marks: {
      sql: `SELECT m.ts FROM ${compiled.source} WHERE ${where} AND m.ts >= ? AND m.ts <= ? ORDER BY m.ts LIMIT 500`,
      params: [...params, input.first ?? '', input.last ?? ''],
    },
  }
}

/**
 * The same predicates as the result list, over every stored message in the topic, and the session's Slack matches in
 * it that are not stored yet (`remote`, their ts): the result list shows those too, and whether the reader has fetched
 * one must not change the count. Only visible marks and adjacent ids leave the engine.
 */
export const searchNavigation = (search: ResolvedSearch, input: Position & { topicId: string }, remote: ReadonlyArray<string> = []) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const [indexed] = yield* sql<Topic>`SELECT channel, root_ts, kind FROM topic_index WHERE topic_id = ${input.topicId}`
  // A thread Slack's search found before any of it is stored has no index row yet; its id names it.
  const parsed = indexed === undefined ? parseTopicId(input.topicId) : undefined
  const topic = indexed ?? (parsed === undefined ? undefined : { channel: parsed.channel, root_ts: parsed.kind === 'thread' ? parsed.threadTs : null, kind: parsed.kind })
  if (topic === undefined) return emptyNavigation
  const statements = searchNavigationStatements(search, topic, input)
  const [nav = emptyNavigation] = yield* sql.unsafe<Omit<SearchNavigation, 'marked'>>(statements.summary.sql, statements.summary.params)
  const marked = input.first === undefined || input.last === undefined ? [] : yield* sql.unsafe<{ ts: string }>(statements.marks.sql, statements.marks.params)
  // A stored match is counted above by the local predicates; only the ones not stored are added.
  const stored = remote.length === 0 ? [] : yield* sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND ts IN ${sql.in(remote)}`
  const known = new Set(stored.map((row) => row.ts))
  const extra = remote.filter((ts) => !known.has(ts))
  const ts = input.ts ?? ''
  const before = extra.filter((other) => other < ts)
  const after = extra.filter((other) => other > ts)
  const latest = (values: ReadonlyArray<string | null>) => values.reduce<string | null>((best, value) => (value !== null && (best === null || value > best) ? value : best), null)
  const earliest = (values: ReadonlyArray<string | null>) => values.reduce<string | null>((best, value) => (value !== null && (best === null || value < best) ? value : best), null)
  return {
    count: nav.count + extra.length,
    index: nav.index + extra.filter((other) => other <= ts).length,
    previous: latest([nav.previous, ...before]),
    next: earliest([nav.next, ...after]),
    marked: marked.map((row) => row.ts),
  }
})
