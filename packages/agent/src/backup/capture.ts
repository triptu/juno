/**
 * Capture for backup (plan v3 §14.4, S6): the SQLite session extension on
 * `agent.sqlite`'s one connection.
 *
 * - A **snapshot** is `VACUUM INTO` a temporary file, with the rows of
 *   local tables deleted from the copy. The migration log stays: it is the
 *   snapshot's schema.
 * - A **segment** is one patchset per replicated table, framed. Patchsets,
 *   not changesets: a changeset carries each updated or deleted row's old
 *   values, so a segment cut after a removal would carry the removed text
 *   (S6 check, 10-15). A patchset carries only new values and keys.
 * - Sessions attach per table, and only to replicated tables (G12), so the
 *   export cursor and other local rows never become a change to export.
 *   A table without a primary key captures nothing, so `replicatedTables`
 *   refuses one.
 *
 * `node:sqlite` is synchronous: a cut, and a snapshot with the new sessions
 * it starts, run without any write between them.
 */
import { rmSync } from 'node:fs'
import { DatabaseSync, type Session } from 'node:sqlite'
import type { Database } from '../store/database'

/** A replicated table SQLite's sessions would skip. */
export class TableWithoutKey extends Error {
  constructor(table: string) {
    super(`table ${table} has no primary key, so backup cannot capture it`)
    this.name = 'TableWithoutKey'
  }
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Every table but SQLite's own and `local`, by name. */
export function replicatedTables(db: Database, local: ReadonlySet<string>): ReadonlyArray<string> {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => !local.has(name))
  for (const name of names) {
    const keyed = (db.prepare(`SELECT count(*) AS n FROM pragma_table_info(${`'${name.replaceAll("'", "''")}'`}) WHERE pk > 0`).get() as { n: number }).n > 0
    if (!keyed) throw new TableWithoutKey(name)
  }
  return names
}

export interface Capture {
  readonly tables: ReadonlyArray<string>
  /** The changes since the last cut as one segment, or undefined if there are none. Starts the next interval. */
  readonly cut: () => Buffer | undefined
  readonly close: () => void
}

export function startCapture(db: Database, tables: ReadonlyArray<string>): Capture {
  let sessions: Array<readonly [string, Session]> = tables.map((table) => [table, db.createSession({ table })] as const)
  const close = () => {
    for (const [, session] of sessions) session.close()
    sessions = []
  }
  return {
    tables,
    cut: () => {
      const frames = sessions.flatMap(([table, session]) => {
        const patch = session.patchset()
        return patch.byteLength === 0 ? [] : [frame(table, patch)]
      })
      if (frames.length === 0) return undefined
      close()
      sessions = tables.map((table) => [table, db.createSession({ table })] as const)
      return Buffer.concat(frames)
    },
    close,
  }
}

function frame(table: string, patch: Uint8Array): Buffer {
  const name = Buffer.from(table)
  const head = Buffer.alloc(6)
  head.writeUInt16BE(name.byteLength, 0)
  head.writeUInt32BE(patch.byteLength, 2)
  return Buffer.concat([head, name, patch])
}

/** Applies a segment to a staging database. Throws if any change conflicts: replay is exact or it stops. */
export function applySegment(db: DatabaseSync, segment: Buffer): void {
  let at = 0
  while (at < segment.byteLength) {
    const nameLength = segment.readUInt16BE(at)
    const length = segment.readUInt32BE(at + 2)
    const table = segment.subarray(at + 6, at + 6 + nameLength).toString()
    const patch = segment.subarray(at + 6 + nameLength, at + 6 + nameLength + length)
    at += 6 + nameLength + length
    if (!db.applyChangeset(patch)) throw new Error(`a backup segment did not apply to ${table}`)
  }
}

/**
 * Copies the database to `path` and deletes the rows of `strip` from the
 * copy. Runs outside any transaction.
 */
export function snapshotInto(db: Database, path: string, strip: ReadonlyArray<string>): void {
  rmSync(path, { force: true })
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`)
  const copy = new DatabaseSync(path)
  try {
    for (const table of strip) {
      if (copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined) copy.exec(`DELETE FROM ${quoted(table)}`)
    }
  } finally {
    copy.close()
  }
}
