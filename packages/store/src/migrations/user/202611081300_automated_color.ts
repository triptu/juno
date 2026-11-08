import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Automated's icon is midnight, the view colour closest to purple, as Juno
 * now makes the view. A view the user gave a colour keeps it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  yield* sql`UPDATE sidebar_views SET color = 'midnight' WHERE id = 'automated' AND color IS NULL`
})
