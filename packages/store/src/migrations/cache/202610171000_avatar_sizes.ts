import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE users ADD COLUMN avatar_small_url TEXT`
  yield* sql`ALTER TABLE users ADD COLUMN avatar_large_url TEXT`
})
