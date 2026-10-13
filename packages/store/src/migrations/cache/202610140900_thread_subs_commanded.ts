import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `thread_subs.commanded`: 1 once a Juno Subscribe or Unsubscribe wrote the
 * row. Slack's `event_ts` cannot be ordered against Juno's own command, so a
 * follow event that contradicts such a row may be older than the command;
 * the sync asks Slack for the root instead of applying it (packages/sync
 * README, "Follow state"; specs/follow.qnt `acceptedUnfollow`).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE thread_subs ADD COLUMN commanded INTEGER NOT NULL DEFAULT 0`
})
