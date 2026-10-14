/**
 * The open `agent.sqlite` with the clock the agent uses, passed to every
 * module that reads or writes it, and the first-open rows.
 */
import { randomBytes } from 'node:crypto'
import { transaction, type Database } from './database'

export interface Store {
  readonly db: Database
  readonly now: () => number
}

/** A UUIDv7: time-ordered, and global across restores (plan v3 §6.1). */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(now, 0, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The singleton rows a new database starts with. A no-op on later opens. */
export function initialize(store: Store): void {
  const { db, now } = store
  transaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO control (singleton, mode, at) VALUES (1, 'on', ?)").run(now())
    db.prepare("INSERT OR IGNORE INTO ownership (singleton, device_id, epoch, state, at) VALUES (1, ?, 1, 'active', ?)").run(uuidv7(now()), now())
    db.prepare('INSERT OR IGNORE INTO memory_head (singleton, rev, gen, pin_rev, batch) VALUES (1, 0, 0, 0, 0)').run()
    db.prepare("INSERT OR IGNORE INTO view_rev (rev, gen, covered, entries) VALUES (0, 0, 0, '[]')").run()
  })
}
