import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Two stamps on `thread_subs`, one per clock, so follow state from pages,
 * events and commands is applied in order (packages/sync README, "Follow
 * state"; specs/follow.qnt):
 *
 * - `updated_event_ts`: Slack's `event_ts` of the last socket event that
 *   wrote the row. An older event does not apply.
 * - `observed_at`: Juno's clock when the row was last observed or changed
 *   (a page's request start, an event's arrival, a command). A page applies
 *   only when its request started after it, so a page in flight during an
 *   unfollow cannot bring the follow back.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE thread_subs ADD COLUMN updated_event_ts TEXT`
  yield* sql`ALTER TABLE thread_subs ADD COLUMN observed_at TEXT`
})
