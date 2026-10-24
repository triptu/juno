import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX messages_search_date ON messages (ts DESC, channel) WHERE deleted = 0`
})
