/**
 * Settings › Juno (plan v3 §7.1, §5.4). Replicated: a backup keeps the
 * owner's choices. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const settings1 = [
  // The owner's choices. A model is saved as its family, so a newer release of the family takes over at
  // the next catalogue refresh. `cap` is the daily cap in nanodollars for days not yet started.
  // No row means the defaults: Claude Sonnet, Claude Haiku and $2.
  `CREATE TABLE juno_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    chat_family TEXT NOT NULL,
    compaction_family TEXT NOT NULL,
    cap INTEGER NOT NULL CHECK (cap >= 0)
  ) STRICT`,
]

export const SETTINGS_MIGRATIONS: MigrationSet = { name: 'settings', steps: [settings1] }
