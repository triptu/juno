/**
 * Drafts per topic (inventory 7), in `user.db` so they outlive tabs and
 * restarts. One row per topic with a draft; an empty draft has no row.
 * `DraftSync` (`draftSync.ts`) keeps them in step with Slack's drafts.
 */
import { draftTopicId } from '@juno/sync'
import { Effect } from 'effect'
import { StoreReader, type InvalidationKeys, type SqlError } from '@juno/store'

export const draftKeys = (topicId: string) => ({ drafts: [topicId] }) satisfies InvalidationKeys

export const readDraft = (id: string): Effect.Effect<string, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const topicId = yield* draftTopicId(sql, id)
    const rows = yield* sql<{ text: string }>`SELECT text FROM drafts WHERE topic_id = ${topicId}`
    return rows[0]?.text ?? ''
  })
