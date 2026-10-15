import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Network copies of a sent post that Juno chose not to delete (ADR 0014,
 * specs/outbox.qnt), and why: the kept message was deleted, or the copy
 * has replies, reactions from others, or an edit. A copy listed here is
 * shown and never queued for a delete again. Rows go with their post's
 * `sent_posts` row, after a week.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS kept_copies (
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      client_msg_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      kept_at INTEGER NOT NULL,
      PRIMARY KEY (channel, ts)
    )`
})
