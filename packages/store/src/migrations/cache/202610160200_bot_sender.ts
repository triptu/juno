import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE messages ADD COLUMN bot_name TEXT`
  yield* sql`ALTER TABLE messages ADD COLUMN bot_icon TEXT`
})
