import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP TRIGGER messages_fts_ai`
  yield* sql`DROP TRIGGER messages_fts_ad`
  yield* sql`DROP TRIGGER messages_fts_au`
  yield* sql`DROP TABLE messages_fts`
  yield* sql`CREATE VIEW message_search_content AS SELECT m.rowid AS rowid,
    m.text || ' ' || COALESCE((SELECT group_concat(atom, ' ') FROM json_tree(m.attachments_json) WHERE type = 'text' AND key IN ('text', 'title', 'value', 'pretext', 'fallback', 'footer', 'alt_text')), '') || ' ' ||
    COALESCE((SELECT group_concat(atom, ' ') FROM json_tree(m.blocks_json) WHERE type = 'text' AND key IN ('text', 'fallback', 'alt_text')), '') AS text FROM messages m`
  yield* sql`CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='message_search_content', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`
  yield* sql`INSERT INTO messages_fts(rowid, text) SELECT rowid, text FROM message_search_content`
  yield* sql`CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, text) SELECT rowid, text FROM message_search_content WHERE rowid = new.rowid; END`
  yield* sql`CREATE TRIGGER messages_fts_ad BEFORE DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) SELECT 'delete', rowid, text FROM message_search_content WHERE rowid = old.rowid; END`
  yield* sql`CREATE TRIGGER messages_fts_bu BEFORE UPDATE OF text, attachments_json, blocks_json ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) SELECT 'delete', rowid, text FROM message_search_content WHERE rowid = old.rowid; END`
  yield* sql`CREATE TRIGGER messages_fts_au AFTER UPDATE OF text, attachments_json, blocks_json ON messages BEGIN INSERT INTO messages_fts(rowid, text) SELECT rowid, text FROM message_search_content WHERE rowid = new.rowid; END`
})
