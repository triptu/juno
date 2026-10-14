import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE notification_log ADD COLUMN candidate_json TEXT`
  yield* sql`ALTER TABLE notification_log ADD COLUMN judgement_json TEXT`
  yield* sql`ALTER TABLE notification_log ADD COLUMN summary_due_at TEXT`
  yield* sql`ALTER TABLE notification_log ADD COLUMN suppressed_at TEXT`
  yield* sql`CREATE INDEX notification_log_pending ON notification_log (summary_due_at) WHERE delivered_at IS NULL AND outcome = 'summary'`
})
