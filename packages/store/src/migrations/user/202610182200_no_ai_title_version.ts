import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Drops `topic_overlay.ai_title_version` and its index. AI titles are no
 * longer made again or blurred by the prompt version that wrote them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  yield* sql`DROP INDEX IF EXISTS topic_overlay_old_ai_title`
  const columns = new Set((yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('topic_overlay')`).map((column) => column.name))
  if (columns.has('ai_title_version')) yield* sql`ALTER TABLE topic_overlay DROP COLUMN ai_title_version`
})
