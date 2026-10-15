import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * The span of each topic the last recheck read (`@juno/sync` `recheck.ts`):
 * when it asked, and the oldest and newest ts its page covered (`to_ts`
 * null: up to the request). A network copy's delete that waited across a
 * gap goes out only once its own topic was rechecked since (ADR 0014).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE rechecked_topics (
      topic_id TEXT PRIMARY KEY,
      requested_at INTEGER NOT NULL,
      from_ts TEXT NOT NULL,
      to_ts TEXT
    )`
})
