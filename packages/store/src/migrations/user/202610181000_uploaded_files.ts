import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Images the user uploaded from Juno, by Slack's file id, with the staged
 * copy under `uploads/` and its pixel size. Slack shares a fresh image
 * before it has made thumbnails, so the sent message shows the staged copy
 * until Slack's thumbnails are stored; then the row goes. Rows older than a
 * week are dropped.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      file_id TEXT PRIMARY KEY,
      staged_name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      uploaded_at INTEGER NOT NULL
    )`
  yield* sql`CREATE INDEX IF NOT EXISTS uploaded_files_uploaded_at ON uploaded_files (uploaded_at)`
})
