import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Topic drafts synced with Slack (architecture 5.7, specs/drafts.qnt).
 *
 * - `draft_sync`: what Juno knows of Slack's draft for a topic: the draft
 *   it links (`slack_id`, none when it links none) and when it linked it
 *   (`seen_at`, Juno's clock), so a list requested before then cannot say
 *   the draft is gone; the newest Slack stamp seen for the place, in epoch
 *   milliseconds (`slack_stamp`); Slack's files on the draft, which every
 *   update keeps (`file_ids`, a JSON array); the `client_msg_id` Juno
 *   creates its draft with; and the drafts Juno deleted, sent or saw
 *   deleted (`gone_ids`, a JSON array of the latest few), whose versions
 *   are ignored.
 * - A local change Slack has not acknowledged is an `outbox` row of kind
 *   `draft` for the topic. Every draft Juno had before this is one: it was
 *   never in Slack, so it is merged with Slack's draft for its place, if
 *   there is one, and uploaded otherwise.
 * - `pending_messages.draft_id`: Slack's draft a message was, which the
 *   post names so Slack drops it on every device.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS draft_sync (
      topic_id TEXT PRIMARY KEY,
      slack_id TEXT,
      slack_stamp TEXT,
      seen_at TEXT,
      file_ids TEXT,
      client_msg_id TEXT,
      gone_ids TEXT
    )`
  yield* sql`CREATE INDEX IF NOT EXISTS draft_sync_slack ON draft_sync (slack_id)`
  const posts = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('pending_messages')`
  if (!posts.some((column) => column.name === 'draft_id')) yield* sql`ALTER TABLE pending_messages ADD COLUMN draft_id TEXT`
  yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at, next_at)
    SELECT 'draft', d.topic_id, '{"gen":1}', d.updated_at, '0' FROM drafts d
    WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.kind = 'draft' AND o.target_key = d.topic_id)`
})
