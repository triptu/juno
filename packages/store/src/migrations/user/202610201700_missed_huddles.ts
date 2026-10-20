import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS huddle_history (
    call_id TEXT PRIMARY KEY, channel TEXT NOT NULL, started_by TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER, thread_ts TEXT,
    joined INTEGER NOT NULL DEFAULT 0, history_known INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0
  )`
  yield* sql`CREATE INDEX IF NOT EXISTS huddle_history_pending ON huddle_history (ended_at DESC) WHERE seen = 0 AND joined = 0 AND history_known = 1`
  yield* sql`CREATE INDEX IF NOT EXISTS huddle_history_channel ON huddle_history (channel, started_at)`
})
