import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `thread_subs.updated_event_ts`: the `event_ts` of the last socket event or
 * command that wrote the row. A `getView` or history page applies its
 * `subscribed` only when its request started after that moment, so a page
 * in flight during an unfollow cannot bring the follow back (architecture
 * 5.4, the same guard reactions use through `messages.last_event_ts`).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE thread_subs ADD COLUMN updated_event_ts TEXT`
})
