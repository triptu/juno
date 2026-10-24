import { StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { storedMe } from './boot'
import type { SyncContext } from './context'
import { reindexTopics } from './reindex'
import { getSyncState, setSyncState } from './write/state'

/** `sync_state` key: what the stored `topic_index` rows mean. */
export const INDEX_VERSION_KEY = 'index-version'

/**
 * The meaning of `topic_index` rows. Bump it when a stored column changes
 * meaning; the next start re-indexes every stored topic from local messages
 * instead of throwing the cache away. 2: `participants_json` holds the
 * senders of the latest unread messages. 3: a preview names user groups
 * ("@handle" or "@group", never the id). 4: a preview without words labels
 * its files ("Image") and stores the sender's namesakes. 5: unread messages
 * cache notification attention for their sender and mention context. 6: a
 * table stored as an unknown block before Juno read tables gives its
 * preview ("Table: Service, Status"). 7: a thread's unread count is exact
 * only when a proven range of its replies reaches back to the read pointer
 * (`thread_ranges`), not when the stored replies reach `reply_count`.
 */
export const INDEX_VERSION = 7

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
