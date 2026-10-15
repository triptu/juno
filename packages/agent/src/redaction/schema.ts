/**
 * Redaction's tables (plan v3 §4.1, §4.5). The tombstones themselves are the
 * core's `redactions` rows and `messages.redacted_gen`. Steps are
 * append-only.
 */
import type { MigrationSet } from '../store/schema'

const redaction1 = [
  // One removal: the owner's Remove (its op) or a remove card's click (its action id). The same op
  // again is the same removal. `messages` are the archive ids it removed; `ops` the inbox ops whose
  // text it cleared.
  `CREATE TABLE removals (
    op_id TEXT PRIMARY KEY,
    gen INTEGER NOT NULL,
    messages TEXT NOT NULL CHECK (json_valid(messages)),
    ops TEXT NOT NULL CHECK (json_valid(ops)),
    at INTEGER NOT NULL
  ) STRICT`,
  // Inbox ops a removal cleared: the chat shows "Removed" in their place, and a quote of one reads Removed.
  `CREATE TABLE removed_ops (
    op_id TEXT PRIMARY KEY,
    gen INTEGER NOT NULL
  ) STRICT`,
  // §4.5 step 3: the purge a removal leaves, one row per step. `done_at` is set when the step finished.
  // Local: the files they delete are this Mac's, and a restore starts a new journal and backup chain.
  `CREATE TABLE redaction_purges (
    gen INTEGER NOT NULL,
    step TEXT NOT NULL CHECK (step IN ('nodes', 'codex', 'journal', 'backup')),
    at INTEGER NOT NULL,
    due_by INTEGER NOT NULL,
    done_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (gen, step)
  ) STRICT`,
]

export const REDACTION_MIGRATIONS: MigrationSet = { name: 'redaction', steps: [redaction1] }

/** Redaction's per-device tables, which a backup never captures. */
export const REDACTION_LOCAL_TABLES = ['redaction_purges'] as const
