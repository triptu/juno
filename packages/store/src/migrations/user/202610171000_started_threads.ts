import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE started_threads (
    client_msg_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    topic_id TEXT NOT NULL UNIQUE,
    root_ts TEXT,
    created_at INTEGER NOT NULL
  )`
  yield* sql`CREATE UNIQUE INDEX started_threads_root ON started_threads(channel, root_ts)`
})
