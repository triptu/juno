import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Read-state mirroring (architecture 5.6, specs/readstate.qnt). `topic_reads`
 * learns Juno's observation clock (`observed_at`), Slack's pointer as Juno
 * last saw it (`slack_read_ts`), and whether Juno has sent a mark for the
 * topic (`commanded`). Pending marks are `outbox` rows of kind `mark`, found
 * by kind and due time.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE topic_reads ADD COLUMN observed_at TEXT`
  yield* sql`ALTER TABLE topic_reads ADD COLUMN slack_read_ts TEXT`
  yield* sql`ALTER TABLE topic_reads ADD COLUMN commanded INTEGER NOT NULL DEFAULT 0`
  yield* sql`CREATE INDEX outbox_kind ON outbox (kind, next_at)`
})
