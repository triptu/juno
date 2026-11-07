import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): one row per message of
 * the user's that someone else reacted to, with the headline Slack's
 * Activity shows: who reacted (`user_id`) with which emoji (`name`) and when
 * (`at`, epoch milliseconds), from `activity.feed` or the socket's latest
 * `reaction_added`. The message and its reactions stay in `messages` and
 * `reactions`. `known`: the stored reactions include the headline's
 * reaction, so a message with no one else's reaction left drops the row.
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
      known INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, ts)
    )`
  yield* sql`CREATE INDEX reaction_feed_at ON reaction_feed (at DESC)`
})
