import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE conversation_repairs (channel TEXT PRIMARY KEY, updated TEXT, history_invalid TEXT) WITHOUT ROWID`
  yield* sql`CREATE TABLE message_updates (channel TEXT NOT NULL, ts TEXT NOT NULL, server_version TEXT NOT NULL,
    PRIMARY KEY (channel, ts)) WITHOUT ROWID`
})
