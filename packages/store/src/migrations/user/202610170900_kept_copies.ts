import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Network copies of a sent post that Juno chose not to delete (ADR 0014,
 * specs/outbox.qnt), and why: the kept message was deleted, the copy has
 * replies, reactions from others or an edit, its topic was not rechecked
 * after a gap, or it shares files. A copy listed here is never queued for
 * a delete again. It is shown, except a file copy (`hidden`), which stays
 * hidden until a reason above shows it. Rows go with their post's
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
      hidden INTEGER NOT NULL DEFAULT 0,
      kept_at INTEGER NOT NULL,
      PRIMARY KEY (channel, ts)
    )`
})
