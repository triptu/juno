import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE VIRTUAL TABLE overlay_titles_fts USING fts5 (manual_title, ai_title, content='topic_overlay', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`
  yield* sql`INSERT INTO overlay_titles_fts (rowid, manual_title, ai_title) SELECT rowid, manual_title, ai_title FROM topic_overlay`
  yield* sql`CREATE TRIGGER overlay_titles_fts_ai AFTER INSERT ON topic_overlay BEGIN INSERT INTO overlay_titles_fts (rowid, manual_title, ai_title) VALUES (new.rowid, new.manual_title, new.ai_title); END`
  yield* sql`CREATE TRIGGER overlay_titles_fts_ad AFTER DELETE ON topic_overlay BEGIN INSERT INTO overlay_titles_fts (overlay_titles_fts, rowid, manual_title, ai_title) VALUES ('delete', old.rowid, old.manual_title, old.ai_title); END`
  yield* sql`CREATE TRIGGER overlay_titles_fts_au AFTER UPDATE OF manual_title, ai_title ON topic_overlay WHEN old.manual_title IS NOT new.manual_title OR old.ai_title IS NOT new.ai_title BEGIN INSERT INTO overlay_titles_fts (overlay_titles_fts, rowid, manual_title, ai_title) VALUES ('delete', old.rowid, old.manual_title, old.ai_title); INSERT INTO overlay_titles_fts (rowid, manual_title, ai_title) VALUES (new.rowid, new.manual_title, new.ai_title); END`
})
