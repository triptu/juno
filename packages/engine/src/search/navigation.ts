import type { SearchNavigation } from '@juno/contract'
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

/** The same predicates as the result list, over every stored message in the topic. Only visible marks and adjacent ids leave the engine. */
export const searchNavigation = (search: ResolvedSearch, input: Position & { topicId: string }) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const [topic] = yield* sql<Topic>`SELECT channel, root_ts, kind FROM topic_index WHERE topic_id = ${input.topicId}`
  if (topic === undefined) return emptyNavigation
  const statements = searchNavigationStatements(search, topic, input)
  const [nav] = yield* sql.unsafe<Omit<SearchNavigation, 'marked'>>(statements.summary.sql, statements.summary.params)
  const marked = input.first === undefined || input.last === undefined ? [] : yield* sql.unsafe<{ ts: string }>(statements.marks.sql, statements.marks.params)
  return { ...(nav ?? emptyNavigation), marked: marked.map((row) => row.ts) }
})
