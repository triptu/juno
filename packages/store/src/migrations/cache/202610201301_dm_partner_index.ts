import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * A DM by the person it is with: the message list finds the DM of each app
 * and deactivated person it shows (SPEC 7, "People"), and a link to a
 * person finds yours with them (`people.locate`), without a scan of every
 * conversation.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX conversations_im_user ON conversations (user_id) WHERE kind = 'im'`
})
