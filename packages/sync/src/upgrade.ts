import { StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { storedMe } from './boot'
import type { SyncContext } from './context'
import { INDEX_VERSION } from './indexVersion'
import { reindexTopics } from './reindex'
import { getSyncState, setSyncState } from './write/state'

/** `sync_state` key: what the stored `topic_index` rows mean. */
export const INDEX_VERSION_KEY = 'index-version'

export { INDEX_VERSION }

/** Rows per transaction, so the writer is never held long (performance rule 15). */
const BATCH = 200

/**
 * Brings stored index rows up to `INDEX_VERSION` once, on start: `indexTopic`
 * over the messages already in the store, a batch per transaction with a
 * yield between. Nothing is asked of Slack, not even a missing user's name;
 * the sync names those as it meets them. Returns how many topics it read.
 */
export const upgradeIndex = (ctx: SyncContext): Effect.Effect<number, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if ((yield* getSyncState<number>(INDEX_VERSION_KEY)) === INDEX_VERSION) return 0
    const sql = yield* StoreWriter
    const ids = (yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_index`).map((row) => row.topic_id)
    // The user groups from the last boot, so mentions of a group the user is in still count.
    const me = (yield* storedMe) ?? ctx.me
    for (let i = 0; i < ids.length; i += BATCH) {
      yield* transaction(reindexTopics(ids.slice(i, i + BATCH), { me, onMissingUsergroup: (topicId) => ctx.usergroupTopics.add(topicId) }))
      yield* Effect.yieldNow
    }
    yield* setSyncState(INDEX_VERSION_KEY, INDEX_VERSION)
    return ids.length
  })
