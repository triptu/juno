import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** A person's Slack status: text, ":emoji:" and expiry in epoch seconds (0 for never). Null until a user object carried them. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE users ADD COLUMN status_text TEXT`
  yield* sql`ALTER TABLE users ADD COLUMN status_emoji TEXT`
  yield* sql`ALTER TABLE users ADD COLUMN status_expiration INTEGER`
})
