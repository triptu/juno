import { Schema, SchemaRepresentation } from 'effect'
import { Digest, digestJson } from '@juno/agent-cards'
import type { Tool } from '@earendil-works/pi-mcp'
import type { Store } from '../store/store'
import { transaction } from '../store/database'
import type { ConnectionConfig } from './types'

const Row = Schema.Struct({
  name: Schema.String, definition: Schema.String, hash: Digest,
  tier: Schema.Literals([0, 3]), changed: Schema.Number, present: Schema.Number,
})
export const jsonObject = Schema.Record(Schema.String, Schema.Json)
export const parseObject = Schema.decodeUnknownSync(jsonObject)
export const json = Schema.decodeUnknownSync(Schema.Json)

export function catalogue(store: Store, id: string) {
  return Schema.decodeUnknownSync(Schema.Array(Row))(store.db.prepare('SELECT name, definition, hash, tier, changed, present FROM mcp_tools WHERE connection_id = ?').all(id))
}

export function discover(store: Store, config: ConnectionConfig, tools: ReadonlyArray<Tool>, first: boolean): void {
  const previous = new Map(catalogue(store, config.id).map((row) => [row.name, row]))
  transaction(store.db, () => {
    store.db.prepare('UPDATE mcp_tools SET present = 0 WHERE connection_id = ?').run(config.id)
    for (const tool of tools) {
      const definition = json(tool)
      const hash = digestJson(json({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null }))
      const old = previous.get(tool.name)
      const changed = old !== undefined && (old.hash !== hash || old.changed === 1)
      const tier = old ? (old.hash === hash ? old.tier : 3) : first && config.allowlist.includes(tool.name) ? 0 : 3
      store.db.prepare(`INSERT INTO mcp_tools VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(connection_id,name) DO UPDATE SET definition=excluded.definition, hash=excluded.hash, tier=excluded.tier, changed=excluded.changed, present=1`)
        .run(config.id, tool.name, JSON.stringify(definition), hash, tier, changed ? 1 : 0)
    }
    store.db.prepare('UPDATE mcp_connections SET discovered = 1 WHERE id = ?').run(config.id)
  })
}

/** Unsupported schema features fail closed; server patterns are never evaluated. */
export function validateArguments(definition: string, args: unknown): void {
  const tool = parseObject(JSON.parse(definition))
  const input = parseObject(tool.inputSchema ?? { type: 'object' })
  const schema = SchemaRepresentation.fromJsonSchemaDocument({ dialect: 'draft-2020-12', schema: input, definitions: {} })
  Schema.decodeUnknownSync(Schema.toEncoded(schema), { onExcessProperty: 'error' })(args)
}
