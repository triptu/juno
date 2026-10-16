import type { MigrationSet } from '../store/schema'

export const SCRIPT_MIGRATIONS: MigrationSet = { name: 'scripts', steps: [[
  // Every child call a codemode script made (docs/research/codemode.md), written before it runs.
  //   id         pi's nested call id, `<script call id>/c<n>`: stable when pi replays the script
  //   script_id  the codemode call's id
  //   run_id     the run the script ran in
  //   args       the arguments as the script passed them, JSON
  //   outcome    running until it ends; done, failed, cancelled (Pause, AI off, or the script ended first) or
  //              refused (not a read, or over a limit). A row still running after its run ended did not finish.
  //   detail     an error's text, or the size of the result
  `CREATE TABLE script_calls (
    id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL,
    run_id TEXT REFERENCES runs(id),
    tool TEXT NOT NULL,
    args TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'done', 'failed', 'cancelled', 'refused')),
    detail TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  ) STRICT`,
  'CREATE INDEX script_calls_by_run ON script_calls (run_id, started_at)',
]] }
