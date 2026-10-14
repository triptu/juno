/**
 * The owner lock (plan v3 §2.2, §14.1, G9; spec `acquire`, `collect`,
 * `releaseLock`). One process on this Mac writes the agent directory.
 *
 * `owner.lock` is an SQLite file held with `locking_mode = EXCLUSIVE` after
 * one write transaction. Another process gets "database is locked" at once
 * (busy timeout 0). The kernel drops the lock when the holder dies, also on
 * `kill -9` (spikes S5). Node has no `flock`.
 *
 * The connection must stay referenced: a collected `DatabaseSync` closes and
 * silently drops the lock while the process still writes (spec `collect`,
 * `lockHandle`). `held` keeps it for the life of the process, and only
 * `release()` closes it, which the caller does after the agent's own writes
 * have stopped (spec `lockLifetime`).
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const OWNER_LOCK_FILE = 'owner.lock'

/** Another process holds the agent directory. */
export class OwnerLockHeld extends Error {
  readonly path: string
  constructor(path: string) {
    super(`another Juno process owns ${path}`)
    this.name = 'OwnerLockHeld'
    this.path = path
  }
}

export interface OwnerLock {
  readonly path: string
  /** Closes the lock connection. Call only after every owned write has stopped. */
  readonly release: () => void
}

/** Module-level, so the lock connection is never collected while the process runs. */
const held = new Map<string, DatabaseSync>()

export function acquireOwnerLock(agentDir: string): OwnerLock {
  const path = join(agentDir, OWNER_LOCK_FILE)
  if (held.has(path)) throw new OwnerLockHeld(path)
  const db = new DatabaseSync(path, { timeout: 0 })
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    // The exclusive lock is taken by the first write and kept until the connection closes.
    db.exec('BEGIN EXCLUSIVE')
    db.exec('CREATE TABLE IF NOT EXISTS holder (singleton INTEGER PRIMARY KEY, pid INTEGER NOT NULL, at INTEGER NOT NULL)')
    db.prepare('INSERT OR REPLACE INTO holder VALUES (1, ?, ?)').run(process.pid, Date.now())
    db.exec('COMMIT')
  } catch (error) {
    db.close()
    if (/locked|busy/i.test(String((error as Error).message))) throw new OwnerLockHeld(path)
    throw error
  }
  held.set(path, db)
  return {
    path,
    release: () => {
      held.get(path)?.close()
      held.delete(path)
    },
  }
}
