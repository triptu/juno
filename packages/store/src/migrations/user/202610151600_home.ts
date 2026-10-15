import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Home (SPEC section 12, `docs/design/home/`).
 *
 * `topic_visits`: topics the user had open for more than a minute, with when
 * they were last seen, for "Pick up where you left off". The engine keeps
 * the newest few.
 *
 * `follow_ups`: things the user said they would do, found by the assistant
 * in their own messages (the `followUps` task). One row per message;
 * `done_at` is set by Mark done and keeps the message from coming back.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE topic_visits (
    topic_id TEXT PRIMARY KEY,
    seen_at TEXT NOT NULL
  )`
  yield* sql`CREATE INDEX topic_visits_seen ON topic_visits (seen_at)`
  yield* sql`CREATE TABLE follow_ups (
    topic_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    text TEXT NOT NULL,
    found_at TEXT NOT NULL,
    done_at TEXT,
    PRIMARY KEY (topic_id, message_ts)
  )`
})
