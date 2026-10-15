/**
 * Drafts per topic (inventory 7), in `user.db` so they outlive tabs and
 * restarts. One row per topic with a draft; an empty draft has no row.
 */
import { Clock, Effect } from 'effect'
import { Invalidation, StoreReader, StoreWriter, type InvalidationKeys, type SqlError } from '@juno/store'

export const draftKeys = (topicId: string) => ({ drafts: [topicId] }) satisfies InvalidationKeys

export const readDraft = (topicId: string): Effect.Effect<string, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<{ text: string }>`SELECT text FROM drafts WHERE topic_id = ${topicId}`
    return rows[0]?.text ?? ''
  })

export const writeDraft = (topicId: string, text: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (text.trim() === '') return yield* clearDraft(topicId)
    const sql = yield* StoreWriter
    const now = yield* Clock.currentTimeMillis
    yield* sql`INSERT INTO drafts (topic_id, text, updated_at) VALUES (${topicId}, ${text}, ${String(now)})
      ON CONFLICT (topic_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
    yield* Invalidation.use((i) => i.invalidate(draftKeys(topicId)))
  })

export const clearDraft = (topicId: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM drafts WHERE topic_id = ${topicId}`
    yield* Invalidation.use((i) => i.invalidate(draftKeys(topicId)))
  })
