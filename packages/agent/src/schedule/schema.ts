import type { MigrationSet } from '../store/schema'
export const SCHEDULE_MIGRATIONS: MigrationSet = {
  name: 'schedules',
  steps: [[
    `CREATE TABLE schedules (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, definition TEXT NOT NULL CHECK(json_valid(definition)),
      state TEXT NOT NULL CHECK(state IN ('active','paused','deleted')), due_at INTEGER NOT NULL,
      source_op TEXT NOT NULL, creation_key TEXT NOT NULL UNIQUE
    ) STRICT`,
    `CREATE TABLE schedule_occurrences (
      schedule_id TEXT NOT NULL REFERENCES schedules(id), revision INTEGER NOT NULL, due_at INTEGER NOT NULL,
      op_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('queued','admitted','started','cancelled')),
      PRIMARY KEY(schedule_id, revision, due_at)
    ) STRICT`,
    'CREATE INDEX schedule_due ON schedules(state, due_at)',
  ]],
}
