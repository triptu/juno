import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): one row per message of
 * the user's that someone else reacted to, with when the latest of those
 * reactions came (`at`, epoch milliseconds) and who added it with which
 * emoji. Slack's `activity.feed` and the socket's `reaction_added` write it;
 * the message and its reactions stay in `messages` and `reactions`.
 * `fetched_at` is the `at` the stored reactions are known to include: the
 * socket's own event, or a fetch of the message. A row with an older or no
 * `fetched_at` has its message fetched once more.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE reaction_feed (
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      at INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      fetched_at INTEGER,
      PRIMARY KEY (channel, ts)
    )`
  yield* sql`CREATE INDEX reaction_feed_at ON reaction_feed (at DESC)`
})
