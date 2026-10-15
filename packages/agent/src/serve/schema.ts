/**
 * The chat server's tables. Replicated records: a restore keeps what the
 * owner had read and where each bubble sits. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const chat1 = [
  // The read mark: Juno's bubbles at or before `through_at` are read (SPEC: fully on screen for one second).
  // It only moves forward.
  `CREATE TABLE chat_read (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    through_at INTEGER NOT NULL
  ) STRICT`,
  // When each Juno bubble was first shown: live, when the model closed it; otherwise its archive row's
  // time. Bubbles are listed and marked read by this time, so a bubble keeps its place and its read
  // state when its run ends and is archived, and across a restart in the middle of a run.
  `CREATE TABLE chat_bubbles (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  ) STRICT`,
]

export const CHAT_MIGRATIONS: MigrationSet = { name: 'chat', steps: [chat1] }
