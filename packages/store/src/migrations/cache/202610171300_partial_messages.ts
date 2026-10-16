import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `messages.partial`: the row came from a search match and lacks the
 * reactions, files and blocks a page carries. Opening a thread does not
 * count such a reply as stored. Replies stored before this column whose
 * content has no blocks may be search matches, so they are marked: the
 * next open of their thread fetches them in full once.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE messages ADD COLUMN partial INTEGER NOT NULL DEFAULT 0`
  yield* sql`UPDATE messages SET partial = 1
    WHERE thread_ts IS NOT NULL AND thread_ts <> ts AND deleted = 0 AND blocks_json IS NULL AND files_json IS NULL AND user_id IS NOT NULL`
})
