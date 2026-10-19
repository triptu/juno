import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `pending_messages.share_json`: a forward (spec section 7, "Forward").
 * The row is posted with `chat.shareMessage` instead of
 * `chat.postMessage`, naming the message it forwards, and the list shows
 * that message as a shared card under the note until Slack's copy is
 * stored. JSON `{ channel, ts, attachment }`; null for every other post.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  const columns = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('pending_messages')`
  if (columns.some((column) => column.name === 'share_json')) return
  yield* sql`ALTER TABLE pending_messages ADD COLUMN share_json TEXT`
})
