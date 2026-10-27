import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Follow new threads (SPEC 5): the conversations where Juno follows every
 * thread whose root is newer than `since_ts`, and the threads it has done
 * that for, so it does each one once. Safe to run again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS follow_new_threads (
    channel TEXT PRIMARY KEY,
    since_ts TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS auto_followed (
    channel TEXT NOT NULL,
    thread_ts TEXT NOT NULL,
    PRIMARY KEY (channel, thread_ts)
  )`
})
