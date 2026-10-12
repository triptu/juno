import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** The mirror tables of `cache.db` (architecture.md section 4.2). */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE team (
      id TEXT PRIMARY KEY,
      name TEXT,
      domain TEXT,
      self_user_id TEXT,
      enterprise_id TEXT,
      prefs_json TEXT,
      booted_at TEXT
    )`

  yield* sql`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      display_name TEXT,
      real_name TEXT,
      avatar_url TEXT,
      tz TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated TEXT
    )`

  yield* sql`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'im', 'mpim')),
      name TEXT,
      user_id TEXT,
      member_ids_json TEXT,
      is_member INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      topic TEXT,
      purpose TEXT,
      created TEXT,
      updated TEXT
    )`

  // The implicit rowid is the key messages_fts points at. cache.db is never
  // VACUUMed (a reset deletes the file), so rowids stay stable.
  yield* sql`
    CREATE TABLE messages (
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      thread_ts TEXT,
      user_id TEXT,
      subtype TEXT,
      text TEXT NOT NULL DEFAULT '',
      blocks_json TEXT,
      files_json TEXT,
      attachments_json TEXT,
      edited_ts TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      client_msg_id TEXT,
      reply_count INTEGER NOT NULL DEFAULT 0,
      latest_reply TEXT,
      reply_users_json TEXT,
      last_event_ts TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, ts)
    )`
  yield* sql`CREATE INDEX messages_thread ON messages (channel, thread_ts, ts)`
  yield* sql`CREATE INDEX messages_client_msg_id ON messages (client_msg_id) WHERE client_msg_id IS NOT NULL`

  // External-content FTS5 index over messages.text, kept in step by triggers
  // so it is written in the same transaction as the message.
  yield* sql`
    CREATE VIRTUAL TABLE messages_fts USING fts5 (
      text,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    )`
  yield* sql`
    CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
    END`
  yield* sql`
    CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END`
  yield* sql`
    CREATE TRIGGER messages_fts_au AFTER UPDATE OF text ON messages BEGIN
      INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
    END`

  yield* sql`
    CREATE TABLE reactions (
      channel TEXT NOT NULL,
      ts TEXT NOT NULL,
      name TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      user_ids_json TEXT,
      me INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, ts, name)
    )`

  yield* sql`
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      name TEXT,
      mimetype TEXT,
      size INTEGER,
      url_private TEXT,
      thumb_json TEXT,
      permalink TEXT,
      user_id TEXT,
      created TEXT
    )`

  yield* sql`
    CREATE TABLE emoji (
      name TEXT PRIMARY KEY,
      url TEXT,
      alias_for TEXT
    )`

  yield* sql`
    CREATE TABLE thread_subs (
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      subscribed INTEGER NOT NULL DEFAULT 0,
      slack_last_read TEXT,
      PRIMARY KEY (channel, thread_ts)
    )`

  yield* sql`
    CREATE TABLE channel_reads (
      channel TEXT PRIMARY KEY,
      slack_last_read TEXT,
      latest TEXT,
      has_unreads INTEGER NOT NULL DEFAULT 0,
      mention_count INTEGER NOT NULL DEFAULT 0,
      counts_updated TEXT
    )`

  // Explicit, only history pages extend them; socket events never move them.
  yield* sql`
    CREATE TABLE synced_ranges (
      channel TEXT NOT NULL,
      from_ts TEXT NOT NULL,
      to_ts TEXT NOT NULL,
      PRIMARY KEY (channel, from_ts)
    )`

  yield* sql`
    CREATE TABLE thread_cursors (
      channel TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      replies_complete INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT,
      PRIMARY KEY (channel, thread_ts)
    )`

  // Written only by reindexTopics in @juno/sync.
  yield* sql`
    CREATE TABLE topic_index (
      topic_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('thread', 'main', 'group')),
      last_activity_ts TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      participants_json TEXT,
      root_ts TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      unread_exact INTEGER NOT NULL DEFAULT 0,
      mentions_me INTEGER NOT NULL DEFAULT 0,
      preview_json TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    )`
  yield* sql`CREATE INDEX topic_index_activity ON topic_index (last_activity_ts DESC)`
  yield* sql`CREATE INDEX topic_index_channel ON topic_index (channel)`

  yield* sql`
    CREATE TABLE sync_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    )`

  yield* sql`
    CREATE TABLE ai_cache (
      task TEXT NOT NULL,
      key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      output_json TEXT NOT NULL,
      model TEXT,
      cost_usd REAL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task, key)
    )`
})
