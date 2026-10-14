/**
 * The chat server's table. A replicated record: a restore keeps what the
 * owner had read. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const chat1 = [
  // The read mark: Juno's bubbles at or before `through_at` are read (SPEC: fully on screen for one second).
  // It only moves forward.
  `CREATE TABLE chat_read (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    through_at INTEGER NOT NULL
  ) STRICT`,
]

export const CHAT_MIGRATIONS: MigrationSet = { name: 'chat', steps: [chat1] }
