/**
 * Drafts per topic (inventory 7), in `user.db` so they outlive tabs and
 * restarts. One row per topic with a draft; an empty draft has no row.
 */
import { parseTopicId } from '@juno/domain'
import { Clock, Effect } from 'effect'
import { Invalidation, StoreReader, StoreWriter, type InvalidationKeys, type SqlError, type SqlClient } from '@juno/store'

export const draftKeys = (topicId: string) => ({ drafts: [topicId] }) satisfies InvalidationKeys

export const readDraft = (id: string): Effect.Effect<string, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const topicId = yield* draftKey(sql, id)
    const rows = yield* sql<{ text: string }>`SELECT text FROM drafts WHERE topic_id = ${topicId}`
    return rows[0]?.text ?? ''
  })

export const writeDraft = (id: string, text: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (text.trim() === '') return yield* clearDraft(id)
    const sql = yield* StoreWriter
    const topicId = yield* draftKey(sql, id)
    const now = yield* Clock.currentTimeMillis
    yield* sql`INSERT INTO drafts (topic_id, text, updated_at) VALUES (${topicId}, ${text}, ${String(now)})
      ON CONFLICT (topic_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
    yield* invalidateDraft(sql, id, topicId)
  })

export const clearDraft = (id: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const topicId = yield* draftKey(sql, id)
    yield* sql`DELETE FROM drafts WHERE topic_id = ${topicId}`
    yield* invalidateDraft(sql, id, topicId)
  })

const draftKey = (sql: SqlClient.SqlClient, id: string) => Effect.gen(function* () {
  const topic = parseTopicId(id)
  if (topic?.kind !== 'thread') return id
  const row = (yield* sql<{ topic_id: string }>`SELECT topic_id FROM started_threads WHERE channel = ${topic.channel} AND root_ts = ${topic.threadTs}`)[0]
  return row?.topic_id ?? id
})

const invalidateDraft = (sql: SqlClient.SqlClient, id: string, topicId: string) => Effect.gen(function* () {
  const root = topicId.startsWith('p:')
    ? (yield* sql<{ channel: string; root_ts: string | null }>`SELECT channel, root_ts FROM started_threads WHERE topic_id = ${topicId}`)[0]
    : undefined
  const ids = root?.root_ts == null ? [id, topicId] : [id, topicId, `t:${root.channel}:${root.root_ts}`]
  yield* Invalidation.use(i => i.invalidate({ drafts: ids }))
})
