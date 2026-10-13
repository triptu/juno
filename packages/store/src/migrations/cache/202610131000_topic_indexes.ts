import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Indexes for the sidebar queries (docs/performance.md section 6): the
 * window by channel and the old-but-unread rows. The partial index keeps
 * the unread lookup bounded by the rows that match, not the table.
 *
 * `thread_cursors.complete_from`: the ts from which every reply of the
 * thread is stored (a thread view stores every unread reply, so coverage is
 * complete from Slack's read pointer). The index uses it to say whether an
 * unread count is exact.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP INDEX IF EXISTS topic_index_channel`
  yield* sql`CREATE INDEX topic_index_channel_activity ON topic_index (channel, last_activity_ts DESC)`
  yield* sql`CREATE INDEX topic_index_unread ON topic_index (last_activity_ts DESC) WHERE unread_count > 0`
  yield* sql`ALTER TABLE thread_cursors ADD COLUMN complete_from TEXT`
})
