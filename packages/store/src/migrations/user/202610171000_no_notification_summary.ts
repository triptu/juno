import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP INDEX notification_log_pending`
  yield* sql`ALTER TABLE notification_log DROP COLUMN summary_due_at`
  yield* sql`UPDATE notification_log SET outcome = 'hold' WHERE outcome = 'summary'`
})
