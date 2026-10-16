import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** The workspace's user groups, so a `<!subteam^S…>` mention shows its handle. A deleted group keeps its row and handle. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE usergroups (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      name TEXT,
      deleted INTEGER NOT NULL DEFAULT 0
    )`
})
