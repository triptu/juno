import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `ai_calls`: the AI activity log in Settings › Juno. One row per model call
 * the engine or the agent made, or one it refused, with its feature, the
 * topic or chat it was for, the model, the outcome, the time it took, the
 * tokens and the estimated cost. Never prompt or response text. The writer
 * keeps the newest 500 rows. A refusal repeated with nothing between them
 * is one row with a count.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS ai_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      last_at INTEGER NOT NULL,
      repeats INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      feature TEXT NOT NULL,
      subject_kind TEXT NOT NULL DEFAULT '',
      subject_id TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      summary TEXT NOT NULL DEFAULT ''
    )`
  yield* sql`CREATE INDEX IF NOT EXISTS ai_calls_at ON ai_calls (at)`
})
