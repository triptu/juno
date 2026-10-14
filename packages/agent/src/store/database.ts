/**
 * `agent.sqlite`: open, durability settings and migrations (plan v3 §2.2).
 *
 * WAL with `synchronous = FULL`, and `fullfsync` for both commits and
 * checkpoints: on macOS a plain fsync does not flush the drive's cache, so
 * FULL alone does not survive power loss (spikes finding 2). SQLite ignores
 * the two fullfsync pragmas on other systems.
 *
 * `node:sqlite` is synchronous, so a commit blocks the event loop for its
 * fsync (about 3 ms with fullfsync, spikes S5). Every write here is one
 * small transaction.
 */
import { DatabaseSync } from 'node:sqlite'
import { CORE_MIGRATIONS, type MigrationSet } from './schema'

export type Database = DatabaseSync

/** The pragmas both `agent.sqlite` and the pi journal facade run before any write. */
export const DURABLE_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = FULL',
  'PRAGMA fullfsync = ON',
  'PRAGMA checkpoint_fullfsync = ON',
] as const

/** The database records migration steps this build does not have: a newer Juno wrote it. */
export class StoreTooNew extends Error {
  readonly unknown: ReadonlyArray<string>
  constructor(unknown: ReadonlyArray<string>) {
    super(`agent.sqlite was written by a newer Juno (unknown steps ${unknown.join(', ')})`)
    this.name = 'StoreTooNew'
    this.unknown = unknown
  }
}

/** Runs `f` in one write transaction. It commits at FULL when `f` returns, and rolls back if it throws. */
export function transaction<T>(db: Database, f: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = f()
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Opens `agent.sqlite`, applies the durability pragmas and brings the schema
 * up to date. Throws `StoreTooNew` without writing if a newer build wrote it.
 */
export function openDatabase(path: string, sets: ReadonlyArray<MigrationSet> = [], now = Date.now): Database {
  const db = new DatabaseSync(path, { timeout: 0 })
  try {
    for (const pragma of DURABLE_PRAGMAS) db.exec(pragma)
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, [CORE_MIGRATIONS, ...sets], now)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function migrate(db: Database, sets: ReadonlyArray<MigrationSet>, now: () => number): void {
  const names = new Set(sets.map((set) => set.name))
  if (names.size !== sets.length) throw new Error('two migration sets share a name')
  const hasLog = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() !== undefined
  const applied = new Set(
    hasLog
      ? db.prepare('SELECT "set", step FROM schema_migrations').all().map((row) => `${row.set as string}/${row.step as number}`)
      : [],
  )
  const known = new Set(sets.flatMap((set) => set.steps.map((_, i) => `${set.name}/${i + 1}`)))
  const unknown = [...applied].filter((step) => !known.has(step))
  if (unknown.length > 0) throw new StoreTooNew(unknown)
  for (const set of sets) {
    set.steps.forEach((statements, i) => {
      if (applied.has(`${set.name}/${i + 1}`)) return
      transaction(db, () => {
        for (const statement of statements) db.exec(statement)
        db.prepare('INSERT INTO schema_migrations ("set", step, applied_at) VALUES (?, ?, ?)').run(set.name, i + 1, now())
      })
    })
  }
}
