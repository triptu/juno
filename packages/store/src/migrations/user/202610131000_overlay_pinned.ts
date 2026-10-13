import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Pinned topics are few; a partial index finds them without touching the
 * rest of the overlay. `topic_reads` learns the event time of the last
 * server mark applied, so marks apply in order (architecture 5.6).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX topic_overlay_pinned ON topic_overlay (pinned_at) WHERE pinned_at IS NOT NULL`
  yield* sql`ALTER TABLE topic_reads ADD COLUMN last_server_event_ts TEXT`
})
