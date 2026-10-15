import { Schema } from 'effect'
import { CardPayload, digestJson, type ExecutableIdentity } from '@juno/agent-cards'
import type { Executor } from '../actions/executor'
import { memoryGen } from '../actions/cards'
import { uuidv7 } from '../store/store'
import type { McpManagerApi } from './manager'
import { McpError, destructiveArguments } from './types'
import { json, parseObject, validateArguments } from './catalogue'
import { notionCheck, notionPreconditions, notionReconcile } from './notion'

export const toolKey = (id: string, name: string) => `mcp:${encodeURIComponent(id)}:${encodeURIComponent(name)}`
const connectHash = (manager: McpManagerApi, id: string) => digestJson(json(manager.stored(id).config))
const identity = (manager: McpManagerApi, id: string, payload: ExecutableIdentity) => {
  const row = manager.stored(id)
  return payload.connection_id !== id ? 'connectionChanged' : payload.account_id !== row.epoch ? 'accountChanged' : 'valid'
}

export function mcpExecutors(manager: McpManagerApi): ReadonlyArray<Executor> {
  return manager.configs().flatMap((config): Executor[] => [
    {
      tool: toolKey(config.id, '$connect'), tier: 3, deduped: false,
      check: async (payload) => identity(manager, config.id, payload) !== 'valid' ? 'connectionChanged' : payload.schema_hash === connectHash(manager, config.id) ? 'valid' : 'schemaChanged',
      run: async () => {
        await manager.authorize(config.id)
        return manager.state(config.id) === 'ready' ? { _tag: 'done', receipt: { connected: true } } : { _tag: 'failed', detail: 'Sign-in did not finish.' }
      },
      reconcile: async () => ({ _tag: 'unknown' }),
    },
    ...manager.definitions(config.id).map((tool): Executor => ({
      tool: toolKey(config.id, tool.name), tier: 3, deduped: false,
      check: async (payload) => {
        const valid = identity(manager, config.id, payload)
        if (valid !== 'valid') return valid
        if (manager.state(config.id) !== 'ready') return 'wait'
        try {
          if (manager.tool(config.id, tool.name).hash !== payload.schema_hash) return 'schemaChanged'
          validateArguments(manager.tool(config.id, tool.name).definition, payload.args)
          await manager.checkSecrets(payload.args)
          if (tool.name === 'notion-update-page' && !await notionCheck(manager, config.id, payload.preconditions)) return 'preconditionFailed'
          return 'valid'
        } catch { return 'preconditionFailed' }
      },
      run: async ({ payload }) => {
        try {
          // Recheck after asynchronous preconditions, before opening the transport.
          if (identity(manager, config.id, payload) !== 'valid' || manager.tool(config.id, tool.name).hash !== payload.schema_hash) return { _tag: 'failed', detail: 'The connection or tool changed.' }
          const result = await manager.invoke(config.id, tool.name, payload.args, true)
          // MCP isError is not proof that a server made no partial change.
          return result.isError ? { _tag: 'unknown', detail: 'The server reported an error.' } : { _tag: 'done', receipt: { confirmed: true } }
        } catch { return { _tag: 'unknown', detail: 'The server did not confirm the change.' } }
      },
      reconcile: async ({ payload }) => {
        if (identity(manager, config.id, payload) !== 'valid' || tool.name !== 'notion-update-page') return { _tag: 'unknown' }
        try {
          const receipt = await notionReconcile(manager, config.id, payload.preconditions)
          return receipt ? { _tag: 'found', receipt } : { _tag: 'unknown' }
        } catch { return { _tag: 'unknown' } }
      },
    })),
  ])
}

function child(manager: McpManagerApi, id: string, tool: string, hash: string, args: unknown, preconditions: unknown) {
  return {
    id: uuidv7(manager.store.now()), rev: 1, tier: 3, deduped: false, source: memoryGen(manager.store),
    payload: { connection_id: id, account_id: manager.stored(id).epoch, destination_ids: typeof preconditions === 'object' && preconditions !== null && 'pageId' in preconditions ? [preconditions.pageId] : [], tool, schema_hash: hash, args, preconditions, ops: [] },
  }
}

export async function changeCard(manager: McpManagerApi, id: string, name: string, args: unknown): Promise<CardPayload> {
  const tool = manager.tool(id, name)
  const parsed = parseObject(args)
  if (destructiveArguments(parsed)) throw new McpError({ reason: 'destructive', message: 'Juno does not offer destructive operations.' })
  validateArguments(tool.definition, parsed)
  await manager.checkSecrets(parsed)
  const preconditions = await notionPreconditions(manager, id, name, parsed)
  return Schema.decodeUnknownSync(CardPayload)({
    _tag: 'change', server: manager.stored(id).config.label, target: name,
    action: child(manager, id, toolKey(id, name), tool.hash, parsed, preconditions),
  })
}

export function connectCard(manager: McpManagerApi, id: string): CardPayload {
  const config = manager.stored(id).config
  return Schema.decodeUnknownSync(CardPayload)({
    _tag: 'connect', server: config.label, scopes: [], leaves: `Connect to ${config.url}. The server receives the arguments of tools you use.`,
    action: child(manager, id, toolKey(id, '$connect'), connectHash(manager, id), {}, {}),
  })
}
