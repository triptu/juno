import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * What Home says about an Automated question (SPEC section 12): the count
 * the rules read when they asked (`apps` of `sampled` latest messages came
 * from apps) and Juno's one-line `reason` when Juno judged it. Kept with the
 * row, so the line says why it was asked, not what the channel says now.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  const columns = new Set((yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('automated_channels')`).map((column) => column.name))
  if (!columns.has('apps')) yield* sql`ALTER TABLE automated_channels ADD COLUMN apps INTEGER`
  if (!columns.has('sampled')) yield* sql`ALTER TABLE automated_channels ADD COLUMN sampled INTEGER`
  if (!columns.has('reason')) yield* sql`ALTER TABLE automated_channels ADD COLUMN reason TEXT`
})
