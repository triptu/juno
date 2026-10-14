/**
 * The router's tables (plan v3 §5.2, §8). Replicated records: a backup keeps
 * them. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const turns1 = [
  // One run: from an idle input to its ending. `op_id` is the input that started it; `h` is the
  // history cutoff H, the archive length before that input (§5.2). `clean` is cleared once the run
  // reads untrusted content (§6.4). `ending` is the chat contract's `Ending`, set when the run ends.
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL CHECK (origin IN ('owner', 'wake', 'report', 'click')),
    h INTEGER NOT NULL CHECK (h >= 0),
    clean INTEGER NOT NULL CHECK (clean IN (0, 1)),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ending TEXT CHECK (ending IS NULL OR json_valid(ending)),
    CHECK ((ended_at IS NULL) = (ending IS NULL))
  ) STRICT`,
  'CREATE UNIQUE INDEX runs_one_live ON runs ((ended_at IS NULL)) WHERE ended_at IS NULL',
  // Every inbox op delivered into a run: its first input and its steers.
  `CREATE TABLE run_inputs (
    op_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id),
    steer INTEGER NOT NULL CHECK (steer IN (0, 1))
  ) STRICT`,
  'CREATE INDEX run_inputs_by_run ON run_inputs (run_id)',
]

export const TURNS_MIGRATIONS: MigrationSet = { name: 'turns', steps: [turns1] }
