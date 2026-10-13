import type { SearchResult } from '@juno/contract'
import { ChannelId, firstWords, mainLabel, type ConversationKind } from '@juno/domain'
import { ftsQuery, StoreReader, type SqlClient } from '@juno/store'
import { Effect } from 'effect'

const topicColumns = `i.topic_id AS id, i.channel, i.kind,
  COALESCE(NULLIF(trim(o.manual_title), ''), NULLIF(trim(o.ai_title), '')) AS named_title,
  COALESCE(json_extract(i.preview_json, '$.rootText'), '') AS title,
  c.kind AS channel_kind, COALESCE(c.name, u.display_name, u.real_name, u.name, c.user_id, c.id) AS channel_name`
const topicJoins = `JOIN conversations c ON c.id = i.channel
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
  LEFT JOIN ignored_channels g ON g.channel = i.channel`
const visible = `c.is_member = 1 AND g.channel IS NULL`

interface TopicHit {
  readonly id: string
  readonly channel: string
  readonly kind: string
  readonly named_title: string | null
  readonly title: string
  readonly channel_kind: ConversationKind
  readonly channel_name: string
}

const topicResult = (hit: TopicHit): SearchResult => ({
  kind: 'topic', id: hit.id, channelId: hit.channel,
  title: hit.kind === 'main' ? mainLabel({ id: ChannelId.make(hit.channel), kind: hit.channel_kind, name: hit.channel_name }) : hit.named_title || firstWords(hit.title) || hit.channel_name,
})

/** The statements used by the query, also compiled by the benchmark profiler. */
export function searchStatements(sql: SqlClient.SqlClient, query: string, limit: number) {
  const topics = sql.unsafe<TopicHit>(`SELECT ${topicColumns} FROM (
      SELECT i.topic_id, rank AS score FROM topic_titles_fts f JOIN topic_index i ON i.rowid = f.rowid WHERE topic_titles_fts MATCH ?
      UNION ALL
      SELECT o.topic_id, rank AS score FROM overlay_titles_fts f JOIN topic_overlay o ON o.rowid = f.rowid WHERE overlay_titles_fts MATCH ?
    ) hits JOIN topic_index i ON i.topic_id = hits.topic_id ${topicJoins}
    WHERE ${visible} GROUP BY i.topic_id ORDER BY MIN(hits.score), i.last_activity_ts DESC, i.topic_id LIMIT ?`, [query, query, limit])
  const channels = sql<{ id: string; name: string }>`SELECT c.id, c.name FROM channels_fts f
    JOIN conversations c ON c.rowid = f.rowid LEFT JOIN ignored_channels g ON g.channel = c.id
    WHERE channels_fts MATCH ${query} AND c.is_member = 1 AND g.channel IS NULL ORDER BY f.rank, c.id LIMIT ${limit}`
  const people = sql<{ id: string; name: string }>`SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.real_name, u.name, u.id) AS name
    FROM people_fts f JOIN users u ON u.rowid = f.rowid WHERE people_fts MATCH ${query} AND u.deleted = 0 ORDER BY f.rank, u.id LIMIT ${limit}`
  const messages = sql<{ channel: string; ts: string; thread_ts: string | null; reply_count: number; text: string }>`SELECT m.channel, m.ts, m.thread_ts, m.reply_count, m.text
    FROM messages_fts f JOIN messages m ON m.rowid = f.rowid JOIN conversations c ON c.id = m.channel
    LEFT JOIN ignored_channels g ON g.channel = m.channel
    WHERE messages_fts MATCH ${query} AND m.deleted = 0 AND c.is_member = 1 AND g.channel IS NULL ORDER BY f.rank LIMIT ${limit}`
  return { topics, channels, people, messages }
}

/** Indexed local search. Titles precede channels, people and message matches; FTS ranks each group. */
export const querySearch = Effect.fn('search.query')(function* (text: string, requestedLimit = 50) {
  const sql = yield* StoreReader
  const limit = Math.max(1, Math.min(50, requestedLimit))
  const terms = ftsQuery(text.trim())
  if (terms === '') {
    const recent = yield* sql.unsafe<TopicHit>(`SELECT ${topicColumns} FROM topic_index i ${topicJoins}
      WHERE ${visible} ORDER BY i.last_activity_ts DESC, i.topic_id LIMIT ?`, [limit])
    return recent.map(topicResult)
  }
  // Only the last word is a prefix, matching an input still being typed.
  const query = `${terms}*`
  const statements = searchStatements(sql, query, limit)
  const topics = yield* statements.topics
  const results: SearchResult[] = topics.map(topicResult)
  if (results.length >= limit) return results
  const channels = yield* statements.channels
  results.push(...channels.map((hit): SearchResult => ({ kind: 'channel', ...hit })))
  if (results.length >= limit) return results.slice(0, limit)
  const people = yield* statements.people
  results.push(...people.map((hit): SearchResult => ({ kind: 'person', ...hit })))
  if (results.length >= limit) return results.slice(0, limit)
  const messages = yield* statements.messages
  results.push(...messages.map((hit): SearchResult => ({ kind: 'message', id: `${hit.channel}:${hit.ts}`, topicId: hit.thread_ts !== null ? `t:${hit.channel}:${hit.thread_ts}` : hit.reply_count > 0 ? `t:${hit.channel}:${hit.ts}` : `m:${hit.channel}`, channelId: hit.channel, ts: hit.ts, text: hit.text })))
  return results.slice(0, limit)
})
