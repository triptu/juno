import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `sidebar_views.color`: the colour of a view's icon, one of the accent
 * names (`VIEW_COLORS` in `@juno/domain`). Null is the neutral default.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  const columns = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('sidebar_views')`
  if (columns.some((column) => column.name === 'color')) return
  yield* sql`ALTER TABLE sidebar_views ADD COLUMN color TEXT`
})
