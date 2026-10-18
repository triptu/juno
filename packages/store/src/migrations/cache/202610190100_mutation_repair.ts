import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE conversation_repairs (channel TEXT PRIMARY KEY, updated TEXT, history_invalid TEXT) WITHOUT ROWID`
  yield* sql`CREATE TABLE repair_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, thread TEXT NOT NULL,
    oldest TEXT NOT NULL, latest TEXT NOT NULL, queued_at INTEGER NOT NULL, cursor TEXT, boundary TEXT, UNIQUE(channel, thread))`
  yield* sql`CREATE TABLE message_updates (channel TEXT NOT NULL, ts TEXT NOT NULL, server_version TEXT NOT NULL,
    PRIMARY KEY (channel, ts)) WITHOUT ROWID`
})
