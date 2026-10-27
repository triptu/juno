import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * Which channel is the workspace's #general (`is_general` in Slack's channel
 * object), which no one can leave: its menus do not offer Leave channel.
 * Existing rows start at 0 and take the flag from the next `client.userBoot`.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE conversations ADD COLUMN is_general INTEGER NOT NULL DEFAULT 0`
})
