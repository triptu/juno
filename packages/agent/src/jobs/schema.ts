/**
 * Background jobs (plan v3 §8): subagents and T3 Code sessions. Replicated
 * records. Steps are append-only.
 */
import type { MigrationSet } from '../store/schema'

const jobs1 = [
  // One job and its Task card. `origin_op` is the message the card sits under; `call_id` is the
  // pi tool call that started it, so a replayed call finds its job. `phase` is agent-cards'
  // JobPhase; `state` is the live line under the title. `step_at` is the last step change
  // or phase move. `quiet` in the CHECK is no longer written (there is no quiet milestone). `reports` counts the reports posted (`report:<job>:<seq>:<event>`).
  `CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('subagent', 't3')),
    run_id TEXT NOT NULL,
    origin_op TEXT NOT NULL,
    call_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    place TEXT NOT NULL,
    task TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('running', 'needsYou', 'quiet', 'lostSight', 'done', 'failed', 'stopping', 'stopped', 'unknown')),
    state TEXT,
    step_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    reports INTEGER NOT NULL DEFAULT 0
  ) STRICT`,
  'CREATE INDEX jobs_by_origin ON jobs (origin_op)',
]

export const JOBS_MIGRATIONS: MigrationSet = { name: 'jobs', steps: [jobs1] }
