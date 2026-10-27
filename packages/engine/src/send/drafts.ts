/**
 * Drafts per topic (inventory 7), in `user.db` so they outlive tabs and
 * restarts. One row per topic with a draft; an empty draft has no row.
 * `DraftSync` (`draftSync.ts`) keeps them in step with Slack's drafts.
 */
import { draftTopicId } from '@juno/sync'
import { Effect } from 'effect'
import { StoreReader, type InvalidationKeys, type SqlError } from '@juno/store'
import type { StoredDraft } from '@juno/contract'

export const draftKeys = (topicId: string) => ({ drafts: [topicId] }) satisfies InvalidationKeys

/** The topic's draft, and the local text a version from another device replaced, if any. */
export const readDraft = (id: string): Effect.Effect<StoredDraft, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const topicId = yield* draftTopicId(sql, id)
    const text = (yield* sql<{ text: string }>`SELECT text FROM drafts WHERE topic_id = ${topicId}`)[0]?.text ?? ''
    const replaced = (yield* sql<{ replaced: string | null }>`SELECT replaced FROM draft_sync WHERE topic_id = ${topicId}`)[0]?.replaced
    return replaced == null ? { text } : { text, replaced }
  })
