import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * A channel's thread roots by ts: the roots with replies. Follow new
 * threads (`followNew.ts` in the engine) reads a conversation's new ones
 * without passing over every message since it was turned on. A query uses
 * it when its WHERE clause carries `reply_count > 0`.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX IF NOT EXISTS messages_thread_roots ON messages (channel, ts) WHERE reply_count > 0`
})
