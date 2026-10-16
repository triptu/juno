import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `sent_posts.deleted_by_user`: the user deleted the post in Juno and Slack
 * applied it (ADR 0014, specs/outbox.qnt). A network copy stored after that
 * is deleted too, not kept as the message: a kept message deleted on
 * another device keeps its copy, but the user's own delete in Juno means
 * the post is gone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  const columns = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('sent_posts')`
  if (columns.some((column) => column.name === 'deleted_by_user')) return
  yield* sql`ALTER TABLE sent_posts ADD COLUMN deleted_by_user INTEGER NOT NULL DEFAULT 0`
})
