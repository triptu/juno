import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `topic_overlay.ai_title_version`: the `titleTopic` version that wrote the AI
 * title. Titles stored before it are NULL: they were made before titles kept
 * sensitive details out, so the title job titles them again, and privacy mode
 * blurs them until then (SPEC section 2, Topic titles). The partial index
 * finds those few without scanning the overlay.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE topic_overlay ADD COLUMN ai_title_version INTEGER`
  yield* sql`CREATE INDEX topic_overlay_old_ai_title ON topic_overlay (topic_id) WHERE ai_title IS NOT NULL AND ai_title_version IS NULL`
})
