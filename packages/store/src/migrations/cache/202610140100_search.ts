import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE VIRTUAL TABLE channels_fts USING fts5 (name, content='conversations', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`
  yield* sql`INSERT INTO channels_fts (rowid, name) SELECT rowid, name FROM conversations`
  yield* sql`CREATE TRIGGER channels_fts_ai AFTER INSERT ON conversations BEGIN INSERT INTO channels_fts (rowid, name) VALUES (new.rowid, new.name); END`
  yield* sql`CREATE TRIGGER channels_fts_ad AFTER DELETE ON conversations BEGIN INSERT INTO channels_fts (channels_fts, rowid, name) VALUES ('delete', old.rowid, old.name); END`
  yield* sql`CREATE TRIGGER channels_fts_au AFTER UPDATE OF name ON conversations WHEN old.name IS NOT new.name BEGIN INSERT INTO channels_fts (channels_fts, rowid, name) VALUES ('delete', old.rowid, old.name); INSERT INTO channels_fts (rowid, name) VALUES (new.rowid, new.name); END`
  yield* sql`CREATE VIRTUAL TABLE people_fts USING fts5 (name, display_name, real_name, content='users', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`
  yield* sql`INSERT INTO people_fts (rowid, name, display_name, real_name) SELECT rowid, name, display_name, real_name FROM users`
  yield* sql`CREATE TRIGGER people_fts_ai AFTER INSERT ON users BEGIN INSERT INTO people_fts (rowid, name, display_name, real_name) VALUES (new.rowid, new.name, new.display_name, new.real_name); END`
  yield* sql`CREATE TRIGGER people_fts_ad AFTER DELETE ON users BEGIN INSERT INTO people_fts (people_fts, rowid, name, display_name, real_name) VALUES ('delete', old.rowid, old.name, old.display_name, old.real_name); END`
  yield* sql`CREATE TRIGGER people_fts_au AFTER UPDATE OF name, display_name, real_name ON users WHEN old.name IS NOT new.name OR old.display_name IS NOT new.display_name OR old.real_name IS NOT new.real_name BEGIN INSERT INTO people_fts (people_fts, rowid, name, display_name, real_name) VALUES ('delete', old.rowid, old.name, old.display_name, old.real_name); INSERT INTO people_fts (rowid, name, display_name, real_name) VALUES (new.rowid, new.name, new.display_name, new.real_name); END`
  yield* sql`CREATE VIRTUAL TABLE topic_titles_fts USING fts5 (title, tokenize='unicode61 remove_diacritics 2')`
  yield* sql`CREATE TRIGGER topic_titles_ai AFTER INSERT ON topic_index BEGIN INSERT INTO topic_titles_fts (rowid, title) VALUES (new.rowid, COALESCE(json_extract(new.preview_json, '$.rootText'), '')); END`
  yield* sql`CREATE TRIGGER topic_titles_ad AFTER DELETE ON topic_index BEGIN DELETE FROM topic_titles_fts WHERE rowid = old.rowid; END`
  yield* sql`CREATE TRIGGER topic_titles_au AFTER UPDATE OF preview_json ON topic_index WHEN old.preview_json IS NOT new.preview_json BEGIN DELETE FROM topic_titles_fts WHERE rowid = old.rowid; INSERT INTO topic_titles_fts (rowid, title) VALUES (new.rowid, COALESCE(json_extract(new.preview_json, '$.rootText'), '')); END`
})
