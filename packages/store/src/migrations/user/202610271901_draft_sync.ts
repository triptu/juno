import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Topic drafts synced with Slack (architecture 5.7, specs/drafts.qnt).
 *
 * - `draft_sync`: what Juno knows of Slack's draft for a topic: the draft
 *   it links (`slack_id`, none when it links none) and when it linked it
 *   (`seen_at`, Juno's clock), so a list requested before then cannot say
 *   the draft is gone; the newest Slack stamp seen for the place, in epoch
 *   milliseconds (`slack_stamp`); whether the linked draft has files from
 *   another device (`has_files`), which Juno shows but never updates or
 *   deletes; the `client_msg_id` Juno creates its draft with; the drafts
 *   Juno saw deleted or retired (`gone_ids`, a JSON array of the latest
 *   few), whose versions are ignored; when the draft was last emptied
 *   (`cleared_at`: Juno's clock for a local clear or send, Slack's stamp for
 *   a deletion taken from Slack), the time a cleared draft's deletion
 *   carries and is compared by; a local edit a newer version from another
 *   device replaced before Slack had it (`replaced`), which ⌘Z in the
 *   composer brings back until the next local change; and the texts Juno
 *   sent from the place (`sent_json`: the text each post carried and Juno's
 *   own texts that can be on the draft it went from, with that draft's id or
 *   its create's `client_msg_id`), which never come back; one is forgotten
 *   only once Slack shows its draft gone or holding another text, and then
 *   past the latest 20.
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
      has_files INTEGER NOT NULL DEFAULT 0,
      client_msg_id TEXT,
      gone_ids TEXT,
      cleared_at TEXT,
      replaced TEXT,
      sent_json TEXT
    )`
  yield* sql`CREATE INDEX IF NOT EXISTS draft_sync_slack ON draft_sync (slack_id)`
  const posts = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('pending_messages')`
  if (!posts.some((column) => column.name === 'draft_id')) yield* sql`ALTER TABLE pending_messages ADD COLUMN draft_id TEXT`
  yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at, next_at)
    SELECT 'draft', d.topic_id, '{"gen":1}', d.updated_at, '0' FROM drafts d
    WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.kind = 'draft' AND o.target_key = d.topic_id)`
})
