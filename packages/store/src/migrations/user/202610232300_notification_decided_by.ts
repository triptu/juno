import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Notifications v2 (SPEC 14): outcomes are `notify` and `stay`, each row
 * says what decided it, and the level or instruction behind it for the why
 * popover. The index serves the burst rule's last banner per topic. Safe
 * to run again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`UPDATE notification_log SET outcome = CASE outcome WHEN 'now' THEN 'notify' WHEN 'hold' THEN 'stay' ELSE outcome END`
  const columns = (yield* sql<{ name: string }>`PRAGMA table_info(notification_log)`).map((column) => column.name)
  if (!columns.includes('decided_by')) yield* sql`ALTER TABLE notification_log ADD COLUMN decided_by TEXT`
  if (!columns.includes('decision_json')) yield* sql`ALTER TABLE notification_log ADD COLUMN decision_json TEXT`
  yield* sql`CREATE INDEX IF NOT EXISTS notification_log_topic_delivered ON notification_log (topic_id, delivered_at) WHERE delivered_at IS NOT NULL`
})
