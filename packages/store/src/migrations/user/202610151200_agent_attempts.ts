import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The host's record of the agent's single-attempt dispatches (plan v3 §6.3,
 * architecture 10). One row per authorization the agent consumed, written
 * before the Slack call, so the same authorization never submits twice,
 * also after the agent or the engine restarts. `state` is `submitted` until
 * the call settles as `done`, `failed` or `unknown`, or `cancelled` when a
 * cancel came before any call; such a row has no action, channel or text,
 * so they are empty. `result_json` keeps the receipt or the
 * reason; later evidence never overwrites a settled row except `unknown`
 * turning `done` on a positive lookup.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE agent_attempts (
    authorization_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE,
    action_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    thread_ts TEXT,
    text TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('submitted', 'done', 'failed', 'unknown', 'cancelled')),
    result_json TEXT,
    created_at TEXT NOT NULL,
    settled_at TEXT
  )`
})
