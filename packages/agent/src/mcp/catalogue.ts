import { Schema, SchemaRepresentation } from 'effect'
import { Digest, digestJson } from '@juno/agent-cards'
import type { Tool } from '@earendil-works/pi-mcp'
import type { Store } from '../store/store'
import { transaction } from '../store/database'
import { ReviewRule } from '@juno/agent-contract'
import { ConnectionConfig, T3 } from './types'

const Row = Schema.Struct({
  name: Schema.String, definition: Schema.String, hash: Digest,
  tier: Schema.Literals([0, 3]), changed: Schema.Number, present: Schema.Number,
  enabled: Schema.Number, review: ReviewRule, read_hint: Schema.Number,
})
export const jsonObject = Schema.Record(Schema.String, Schema.Json)
export const parseObject = Schema.decodeUnknownSync(jsonObject)
export const json = Schema.decodeUnknownSync(Schema.Json)

/**
 * Whether a tool is a read, which runs with no review (SPEC 13.9): its schema
 * is unchanged since Juno first saw it, and either the code's read list names
 * it or the server marked it read-only then. Never from what the server says
 * now. T3 Code's tools can start sessions under many names, so only its read
 * list counts there.
 */
export function isRead(config: ConnectionConfig, row: { readonly name: string; readonly changed: number; readonly read_hint: number }): boolean {
  return row.changed === 0 && (config.allowlist.includes(row.name) || (row.read_hint === 1 && config.id !== T3.id))
}

const configOf = (store: Store, id: string): ConnectionConfig | undefined => {
  const row = store.db.prepare('SELECT config FROM mcp_connections WHERE id = ?').get(id) as { config: string } | undefined
  return row === undefined ? undefined : Schema.decodeUnknownSync(ConnectionConfig)(JSON.parse(row.config))
}

/** The discovered tools, each with `tier` 0 for a read and 3 otherwise, derived now. */
export function catalogue(store: Store, id: string) {
  const config = configOf(store, id)
  return Schema.decodeUnknownSync(Schema.Array(Row))(store.db.prepare('SELECT name, definition, hash, tier, changed, present, enabled, review, read_hint FROM mcp_tools WHERE connection_id = ?').all(id))
    .map((row) => ({ ...row, tier: config !== undefined && isRead(config, row) ? 0 as const : 3 as const }))
}

export function discover(store: Store, config: ConnectionConfig, tools: ReadonlyArray<Tool>): void {
  const previous = new Map(catalogue(store, config.id).map((row) => [row.name, row]))
  transaction(store.db, () => {
    store.db.prepare('UPDATE mcp_tools SET present = 0 WHERE connection_id = ?').run(config.id)
    for (const tool of tools) {
      const definition = json(tool)
      const hash = digestJson(json({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null }))
      const old = previous.get(tool.name)
      const changed = old !== undefined && (old.hash !== hash || old.changed === 1)
      // A read-only claim counts only as the server made it when Juno first saw the tool.
      const readHint = old !== undefined ? old.read_hint : tool.annotations?.readOnlyHint === true ? 1 : 0
      const row = { name: tool.name, changed: changed ? 1 : 0, read_hint: readHint }
      // A changed tool is not the one the owner chose Never ask for; it goes back to Auto. Always ask stays.
      const review = old === undefined ? 'auto' : old.hash !== hash && old.review === 'never' ? 'auto' : old.review
      store.db.prepare(`INSERT INTO mcp_tools (connection_id, name, definition, hash, tier, changed, present, enabled, review, read_hint) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
        ON CONFLICT(connection_id,name) DO UPDATE SET definition=excluded.definition, hash=excluded.hash, tier=excluded.tier, changed=excluded.changed, present=1, review=excluded.review`)
        .run(config.id, tool.name, JSON.stringify(definition), hash, isRead(config, row) ? 0 : 3, row.changed, review, readHint)
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
