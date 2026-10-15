import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE agent_resolves (
    action_id TEXT PRIMARY KEY,
    authorization_id TEXT NOT NULL UNIQUE,
    attempt_id TEXT NOT NULL UNIQUE,
    digest TEXT NOT NULL,
    undo TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  )`
})
