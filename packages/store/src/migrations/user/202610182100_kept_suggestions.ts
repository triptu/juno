import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Home's Unfollow and Ignore suggestions (`docs/design/settled-suggestions/`):
 * when the user chose Keep following on a thread (`unfollow_kept_ts`) or
 * Keep showing on a channel (`ignore_kept_ts`, on the channel's Main), as a
 * Slack ts of that moment. The suggestion waits its full time again from it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  const columns = new Set((yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('topic_overlay')`).map((column) => column.name))
  if (!columns.has('unfollow_kept_ts')) yield* sql`ALTER TABLE topic_overlay ADD COLUMN unfollow_kept_ts TEXT`
  if (!columns.has('ignore_kept_ts')) yield* sql`ALTER TABLE topic_overlay ADD COLUMN ignore_kept_ts TEXT`
})
