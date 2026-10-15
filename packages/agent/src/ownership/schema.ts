/**
 * What this Mac knows about ownership beside the core `ownership` row
 * (plan v3 §14). Local: a backup never carries it. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const ownership1 = [
  // device_name  the other Mac, while it owns Juno (after a move, or a newer owner seen in the folder)
  // move_code    released: the code of this Mac's final manifest; recovery: the code of the move restored
  // backup_at    recovery: when the restored backup was taken; Activate must name it
  // trusted      recovery: a trusted deletion record checked the install; 0 shows "Juno can't check
  //              that this backup is the newest" on the Review page (G13)
  `CREATE TABLE ownership_detail (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    device_name TEXT,
    move_code TEXT,
    backup_at INTEGER,
    trusted INTEGER CHECK (trusted IS NULL OR trusted IN (0, 1))
  ) STRICT`,
]

export const OWNERSHIP_MIGRATIONS: MigrationSet = { name: 'ownership', steps: [ownership1] }

export const OWNERSHIP_LOCAL_TABLES: ReadonlyArray<string> = ['ownership_detail']
