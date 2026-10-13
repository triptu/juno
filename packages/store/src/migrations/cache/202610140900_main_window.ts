import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The Main window index (performance 6, M4): a channel's Main messages by
 * ts, without its thread replies. Main is the roots and the replies also
 * sent to the channel; the partial index holds only those, so a window of
 * Main reads its rows and never skips over replies. A query uses it when
 * its WHERE clause carries the same condition (`MAIN_CONDITION` in the
 * engine's `messages/window.ts`).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX messages_main ON messages (channel, ts)
    WHERE thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast'`
})
