import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * `thread_ranges`: the stretches of a thread's replies that pages proved,
 * as Main's `synced_ranges` do for history (`@juno/sync` `threadRanges.ts`).
 * A row says every reply with `from_ts < ts <= to_ts` is stored; `from_ts`
 * is the root when the page started there. `tail` says what is known after
 * `to_ts`: `none`, `live` (the page reached the newest reply on a socket
 * connection that has not dropped since, so every later reply arrives as an
 * event) or `held` (a followed thread's live tail across a drop: trusted for
 * the unread count, since the reconnect's `getView` brings every unread
 * reply, but not for showing replies as continuous).
 *
 * It replaces `thread_cursors`, whose `replies_complete` and
 * `complete_from` judged coverage from `reply_count` and so trusted guesses.
 * Existing threads start with no ranges: their coverage is unknown until a
 * page proves it, and the first open fetches it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE thread_ranges (
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      from_ts TEXT NOT NULL,
      to_ts TEXT NOT NULL,
      tail TEXT NOT NULL DEFAULT 'none' CHECK (tail IN ('none', 'live', 'held')),
      PRIMARY KEY (channel, thread_ts, from_ts)
    )`
  yield* sql`DROP TABLE thread_cursors`
})
