import type { MigrationSet } from '../store/schema'

export const VIEW_MIGRATIONS: MigrationSet = { name: 'view_changes', steps: [[
  `CREATE TABLE view_changes (
    card_id TEXT PRIMARY KEY REFERENCES cards(id),
    account_id TEXT NOT NULL,
    undo TEXT NOT NULL CHECK (json_valid(undo)),
    undone INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0, 1))
  ) STRICT`,
]] }
