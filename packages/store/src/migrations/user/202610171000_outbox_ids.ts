import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * `outbox` ids are never reused (specs/outbox.qnt). A plain `INTEGER PRIMARY
 * KEY` gives a new row the id of the newest row just deleted, so a delete
 * that replaced an edit whose call was out took the edit's id, and the
 * edit's answer, which ends its row by id, ended the delete. With
 * `AUTOINCREMENT` a finished call can only end the row it read.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP TABLE IF EXISTS outbox_next`
  yield* sql`
    CREATE TABLE outbox_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      target_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      depends_on TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at TEXT,
      last_error TEXT
    )`
  yield* sql`INSERT INTO outbox_next (id, kind, target_key, payload_json, depends_on, created_at, attempts, next_at, last_error)
    SELECT id, kind, target_key, payload_json, depends_on, created_at, attempts, next_at, last_error FROM outbox`
  yield* sql`DROP TABLE outbox`
  yield* sql`ALTER TABLE outbox_next RENAME TO outbox`
  yield* sql`CREATE INDEX outbox_target ON outbox (target_key, id)`
  yield* sql`CREATE INDEX outbox_kind ON outbox (kind, next_at)`
})
