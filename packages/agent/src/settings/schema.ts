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

const settings2 = [
  // The chat model on a custom OpenAI-compatible endpoint, by id: listed by the endpoint or typed in.
  // Compaction uses it too there. Null until the owner picks one.
  'ALTER TABLE juno_settings ADD COLUMN custom_model TEXT',
]

const settings3 = [
  // The fallback family on OpenRouter, asked once when the model refuses under its policy or is
  // unavailable, by Juno's chats and the engine's AI jobs; 'none' turns it off.
  "ALTER TABLE juno_settings ADD COLUMN fallback_family TEXT NOT NULL DEFAULT 'flash'",
]

export const SETTINGS_MIGRATIONS: MigrationSet = { name: 'settings', steps: [settings1, settings2, settings3] }
