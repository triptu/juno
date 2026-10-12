import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** The durable tables of `user.db` (architecture.md section 4.3). */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE topic_overlay (
      topic_id TEXT PRIMARY KEY,
      manual_title TEXT,
      ai_title TEXT,
      ai_title_source_hash TEXT,
      ai_title_at TEXT,
      resolved_at TEXT,
      resolved_activity_ts TEXT,
      reopened_at TEXT,
      pinned_at TEXT,
      unsubscribed_at TEXT,
      tracked INTEGER NOT NULL DEFAULT 0,
      settled_dismissed_ts TEXT,
      grouping_dismissed_ts TEXT
    )`

  yield* sql`
    CREATE TABLE topic_reads (
      topic_id TEXT PRIMARY KEY,
      last_read_ts TEXT,
      marked_unread INTEGER NOT NULL DEFAULT 0,
      local_write_ack_ts TEXT
    )`

  yield* sql`
    CREATE TABLE main_groups (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL
    )`
  yield* sql`CREATE INDEX main_groups_channel ON main_groups (channel)`

  yield* sql`
    CREATE TABLE main_group_msgs (
      group_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      PRIMARY KEY (group_id, ts)
    )`

  yield* sql`
    CREATE TABLE ignored_channels (
      channel TEXT PRIMARY KEY,
      ignored_at TEXT NOT NULL
    )`

  yield* sql`
    CREATE TABLE pending_messages (
      client_msg_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      thread_ts TEXT,
      text TEXT NOT NULL DEFAULT '',
      blocks_json TEXT,
      file_ids_json TEXT,
      created_at TEXT NOT NULL,
      ts TEXT
    )`
  yield* sql`CREATE INDEX pending_messages_channel ON pending_messages (channel, thread_ts)`

  yield* sql`
    CREATE TABLE notification_rules (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      action TEXT NOT NULL
    )`

  yield* sql`
    CREATE TABLE notification_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ai_gate INTEGER NOT NULL DEFAULT 1,
      threshold INTEGER NOT NULL DEFAULT 50,
      digest_times_json TEXT NOT NULL DEFAULT '[]',
      quiet_from TEXT,
      quiet_to TEXT
    )`

  yield* sql`
    CREATE TABLE notification_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      topic_id TEXT,
      preview TEXT,
      outcome TEXT NOT NULL,
      reason TEXT,
      rule_id TEXT,
      ai_score REAL,
      digest_slot TEXT,
      delivered_at TEXT,
      UNIQUE (channel, ts)
    )`
  yield* sql`CREATE INDEX notification_log_at ON notification_log (at)`

  yield* sql`
    CREATE TABLE for_you_cards (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      topic_id TEXT,
      payload_json TEXT NOT NULL,
      input_hash TEXT,
      created_at TEXT NOT NULL,
      dismissed_at TEXT,
      done_at TEXT
    )`

  yield* sql`
    CREATE TABLE juno_chat (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`

  yield* sql`
    CREATE TABLE drafts (
      topic_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`

  yield* sql`
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      target_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      depends_on TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at TEXT,
      last_error TEXT
    )`
  yield* sql`CREATE INDEX outbox_target ON outbox (target_key, id)`

  yield* sql`
    CREATE TABLE prefs (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    )`
})
