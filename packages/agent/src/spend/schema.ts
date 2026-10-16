import type { MigrationSet } from '../store/schema'

export const PROVIDER_LOCAL_TABLES = ['model_catalogue', 'model_resolution', 'provider_bounds'] as const

export const SPEND_MIGRATIONS: MigrationSet = {
  name: 'spend',
  steps: [[
    `CREATE TABLE spend_days (
      day TEXT PRIMARY KEY, cap INTEGER NOT NULL CHECK (cap >= 0)
    ) STRICT`,
    `CREATE TABLE spend_raises (
      id TEXT PRIMARY KEY, day TEXT NOT NULL REFERENCES spend_days(day),
      amount INTEGER NOT NULL CHECK (amount = 1000000000)
    ) STRICT`,
    `CREATE TABLE spend_reservations (
      id TEXT PRIMARY KEY, day TEXT NOT NULL REFERENCES spend_days(day),
      path TEXT NOT NULL CHECK (path IN ('chat', 'subagent', 'compaction')),
      amount INTEGER NOT NULL CHECK (amount >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved', 'unknown', 'settled')),
      actual INTEGER CHECK (actual >= 0),
      CHECK ((state = 'settled') = (actual IS NOT NULL))
    ) STRICT`,
    'CREATE INDEX spend_by_day ON spend_reservations(day)',
    `CREATE TABLE codex_turns (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, thread_id TEXT, home TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE model_catalogue (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), day TEXT NOT NULL, body TEXT NOT NULL CHECK (json_valid(body))
    ) STRICT`,
    `CREATE TABLE model_resolution (
      day TEXT NOT NULL, family TEXT NOT NULL, provider TEXT NOT NULL, slug TEXT NOT NULL,
      PRIMARY KEY (day, family, provider)
    ) STRICT`,
    `CREATE TABLE provider_bounds (
      provider TEXT PRIMARY KEY, multiplier REAL NOT NULL CHECK (multiplier = 1.25)
    ) STRICT`,
  ], [
    // The engine's own model calls (topic art, titles, Home, send checks) spend inside the same cap.
    `CREATE TABLE spend_reservations_next (
      id TEXT PRIMARY KEY, day TEXT NOT NULL REFERENCES spend_days(day),
      path TEXT NOT NULL CHECK (path IN ('chat', 'subagent', 'compaction', 'engine')),
      amount INTEGER NOT NULL CHECK (amount >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved', 'unknown', 'settled')),
      actual INTEGER CHECK (actual >= 0),
      CHECK ((state = 'settled') = (actual IS NOT NULL))
    ) STRICT`,
    'INSERT INTO spend_reservations_next SELECT id, day, path, amount, state, actual FROM spend_reservations',
    'DROP TABLE spend_reservations',
    'ALTER TABLE spend_reservations_next RENAME TO spend_reservations',
    'CREATE INDEX spend_by_day ON spend_reservations(day)',
  ]],
}
