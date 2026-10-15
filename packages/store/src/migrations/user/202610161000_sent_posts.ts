import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The posts Juno has sent (ADR 0014, specs/outbox.qnt). A row is written in
 * the transaction that claims a post, before its one request leaves, and
 * keeps the ts of the first copy Juno stores. The network stack can run a
 * post twice; a second message by `user_id` with the same `client_msg_id`
 * is then a copy, which Juno hides and deletes. Rows older than a week are dropped.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS sent_posts (
      client_msg_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ts TEXT,
      sent_at INTEGER NOT NULL
    )`
  yield* sql`CREATE INDEX IF NOT EXISTS sent_posts_sent_at ON sent_posts (sent_at)`
})
