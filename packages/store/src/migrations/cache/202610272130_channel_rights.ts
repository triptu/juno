import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * What a channel's menu needs to leave out edits Slack would refuse (SPEC
 * 5, "Channel sheet"): whether it is the workspace's general channel,
 * whether it is shared with another organisation (Slack Connect), and who
 * made it. Existing rows take Slack's values at the next `client.userBoot`,
 * which every start runs.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE conversations ADD COLUMN is_general INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE conversations ADD COLUMN is_ext_shared INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE conversations ADD COLUMN creator TEXT`
})
