import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/** Read only the current user's recent sends without walking message history. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX messages_sender_ts ON messages (user_id, ts, channel) WHERE deleted = 0`
})
