import type { MigrationSet } from '../store/schema'

export const MCP_MIGRATIONS: MigrationSet = {
  name: 'mcp',
  steps: [[
    `CREATE TABLE mcp_connections (id TEXT PRIMARY KEY, config TEXT NOT NULL, epoch TEXT NOT NULL, discovered INTEGER NOT NULL DEFAULT 0) STRICT`,
    `CREATE TABLE mcp_tools (connection_id TEXT NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL, hash TEXT NOT NULL, tier INTEGER NOT NULL CHECK(tier IN (0,3)), changed INTEGER NOT NULL, present INTEGER NOT NULL, PRIMARY KEY(connection_id,name)) STRICT`,
  ]],
}
