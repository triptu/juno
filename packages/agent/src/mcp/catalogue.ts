import { Schema, SchemaRepresentation } from 'effect'
import { Digest, digestJson } from '@juno/agent-cards'
import type { Tool } from '@earendil-works/pi-mcp'
import type { Store } from '../store/store'
import { transaction } from '../store/database'
import { ReviewRule } from '@juno/agent-contract'
import { ConnectionConfig, T3, deletes, forbidden } from './types'

const Row = Schema.Struct({
  name: Schema.String, definition: Schema.String, hash: Digest,
  tier: Schema.Literals([0, 3]), changed: Schema.Number, present: Schema.Number,
  enabled: Schema.Number, review: ReviewRule, read_hint: Schema.Number, fresh: Schema.Number,
})
export const jsonObject = Schema.Record(Schema.String, Schema.Json)
export const parseObject = Schema.decodeUnknownSync(jsonObject)
export const json = Schema.decodeUnknownSync(Schema.Json)

type Facts = { readonly name: string; readonly changed: number; readonly read_hint: number }

/**
 * Whether a tool is a read, which runs with no review under any rule (SPEC
 * 13.9): the code's read list names it and its schema is unchanged since Juno
 * first saw it. Never from what a server says.
 */
export function isRead(config: ConnectionConfig, row: Facts): boolean {
  return row.changed === 0 && config.allowlist.includes(row.name)
}

/**
 * The server marked the tool read-only when Juno first saw it, and its schema
 * is unchanged since. Such a call skips the review only in a clean run, and
 * never under Always ask. T3 Code's tools can start sessions under many names,
 * so its hints never count.
 */
export function isHinted(config: ConnectionConfig, row: Facts): boolean {
  return row.changed === 0 && row.read_hint === 1 && config.id !== T3.id && !isRead(config, row)
}

/**
 * A rule the owner cannot change (SPEC 13.9): a tool that merges, buys or
 * force-pushes is never offered; a delete, by its name or the server's own
 * destructive mark, always asks.
 */
export function lockOf(row: { readonly name: string; readonly definition: string }): 'forbidden' | 'delete' | undefined {
  if (forbidden(row.name)) return 'forbidden'
  return deletes(row.name) || parseObject(parseObject(JSON.parse(row.definition)).annotations ?? {}).destructiveHint === true ? 'delete' : undefined
}

const configOf = (store: Store, id: string): ConnectionConfig | undefined => {
  const row = store.db.prepare('SELECT config FROM mcp_connections WHERE id = ?').get(id) as { config: string } | undefined
  return row === undefined ? undefined : Schema.decodeUnknownSync(ConnectionConfig)(JSON.parse(row.config))
}

/** The discovered tools, each with `tier` 0 for a read and 3 otherwise, `hinted` and `lock`, derived now. */
export function catalogue(store: Store, id: string) {
  const config = configOf(store, id)
  return Schema.decodeUnknownSync(Schema.Array(Row))(store.db.prepare('SELECT name, definition, hash, tier, changed, present, enabled, review, read_hint, fresh FROM mcp_tools WHERE connection_id = ?').all(id))
    .map((row) => ({
      ...row, tier: config !== undefined && isRead(config, row) ? 0 as const : 3 as const,
      hinted: config !== undefined && isHinted(config, row), lock: lockOf(row),
    }))
}

export function discover(store: Store, config: ConnectionConfig, tools: ReadonlyArray<Tool>): void {
  const previous = new Map(catalogue(store, config.id).map((row) => [row.name, row]))
  const connectionRule = (store.db.prepare('SELECT review FROM mcp_connections WHERE id = ?').get(config.id) as { review: string } | undefined)?.review
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
      // A changed tool, or one that appears after the owner chose Never ask for the connection, has its
      // own Auto: it does not follow that Never ask until the owner sets a rule again (`rule` in the manager).
      const fresh = old === undefined ? connectionRule === 'never' : old.hash !== hash || old.fresh === 1
      store.db.prepare(`INSERT INTO mcp_tools (connection_id, name, definition, hash, tier, changed, present, enabled, review, read_hint, fresh) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
        ON CONFLICT(connection_id,name) DO UPDATE SET definition=excluded.definition, hash=excluded.hash, tier=excluded.tier, changed=excluded.changed, present=1, review=excluded.review, fresh=excluded.fresh`)
        .run(config.id, tool.name, JSON.stringify(definition), hash, isRead(config, row) ? 0 : 3, row.changed, review, readHint, fresh ? 1 : 0)
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
