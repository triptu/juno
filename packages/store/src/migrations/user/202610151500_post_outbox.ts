import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The send outbox (architecture 5.7, specs/outbox.qnt). A `pending_messages`
 * row is both the message the list shows before Slack has it and the
 * post's place in the queue, so it carries the post's state:
 *
 * - `queued`: not sent, or known not to be posted. The worker may send it.
 * - `sending`: the one request is in flight. Written before the request
 *   leaves, so a restart finds it and treats it as `unknown`.
 * - `unknown`: the answer was lost. Slack may hold the message; only a
 *   lookup for its `client_msg_id` decides.
 * - `failed`: Slack refused it. Waits for Retry or Delete draft.
 *
 * `next_at` is when the worker looks at the row again (epoch millis).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE pending_messages ADD COLUMN state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'unknown', 'failed'))`
  yield* sql`ALTER TABLE pending_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE pending_messages ADD COLUMN next_at INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE pending_messages ADD COLUMN last_error TEXT`
})
