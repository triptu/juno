import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `ai_refusals`: the last input of each task and topic (or channel) that a
 * model refused for a reason trying again cannot change: its policy, a bad
 * request, an input too long (`isFinal` in `@juno/ai`). The engine does not
 * send the same input again; a changed input (a new message, a new title) has
 * another hash and is sent. `key` is the task's key ('' for none), `at` the
 * time of the refusal in milliseconds. A later answer for the key removes it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS ai_refusals (
      task TEXT NOT NULL,
      key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (task, key)
    )`
})
