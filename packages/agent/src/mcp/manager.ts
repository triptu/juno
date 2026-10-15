import { Context, Effect, Layer, Schema } from 'effect'
import { McpAuthRequiredError, type AuthProvider, type McpClient } from '@earendil-works/pi-mcp'
import { McpOAuthAuthorizationRequiredError } from '@earendil-works/pi-mcp/oauth'
import { ConnectionId, type ConnectionsPage, type ConnectionState } from '@juno/agent-contract'
import { uuidv7, type Store } from '../store/store'
import { catalogue, discover, json, parseObject, validateArguments } from './catalogue'
import { clientFor, connectionAuth, signIn } from './auth'
import { ConnectionConfig, McpError, NOTION, denied, destructiveArguments, endpoint, hasSecret, type Credentials } from './types'

const Stored = Schema.Struct({ config: Schema.String, epoch: Schema.String, discovered: Schema.Number })
interface Session {
  state: ConnectionState
  client?: McpClient
  auth?: AuthProvider
  pending?: Promise<void>
  abort: AbortController
  retry?: ReturnType<typeof setTimeout>
  failures: number
}
export interface ManagerOptions {
  readonly store: Store
  readonly credentials: Credentials
  readonly defaults?: ReadonlyArray<ConnectionConfig>
}

export function createMcpManager({ store, credentials, defaults = [NOTION] }: ManagerOptions) {
  const sessions = new Map<string, Session>()
  const listeners = new Set<() => void>()
  let closed = false
  const changed = () => { for (const listener of listeners) listener() }
  const stored = (id: string) => {
    const raw = store.db.prepare('SELECT config, epoch, discovered FROM mcp_connections WHERE id = ?').get(id)
    if (!raw) throw new McpError({ reason: 'invalid', message: 'Unknown connection.' })
    const row = Schema.decodeUnknownSync(Stored)(raw)
    return { ...row, config: Schema.decodeUnknownSync(ConnectionConfig)(JSON.parse(row.config)) }
  }
  const configs = () => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(store.db.prepare('SELECT id FROM mcp_connections ORDER BY id').all()).map(({ id }) => stored(id).config)
  const session = (id: string) => {
    let value = sessions.get(id)
    if (!value) {
      value = { state: 'off', abort: new AbortController(), failures: 0 }
      sessions.set(id, value)
    }
    return value
  }
  const save = (config: ConnectionConfig) => store.db.prepare('UPDATE mcp_connections SET config = ? WHERE id = ?').run(JSON.stringify(config), config.id)
  for (const config of defaults) {
    endpoint(config.url)
    if (config.noSecrets && config.auth.kind === 'bearer') throw new McpError({ reason: 'invalid', message: 'This connection requires its own OAuth sign-in.' })
    store.db.prepare('INSERT OR IGNORE INTO mcp_connections (id,config,epoch) VALUES (?,?,?)').run(config.id, JSON.stringify(config), uuidv7())
  }
  const refresh = async (id: string) => {
    const s = session(id)
    const client = s.client
    if (!client) throw new McpError({ reason: 'unavailable', message: 'Connect the server first.' })
    const tools = await client.listTools()
    if (s.abort.signal.aborted || s.client !== client) return
    const row = stored(id)
    discover(store, row.config, tools, row.discovered === 0)
    s.state = 'ready'
    changed()
  }
  const failed = (id: string, error: unknown) => {
    const s = session(id)
    if (s.abort.signal.aborted || closed) return
    s.state = error instanceof McpOAuthAuthorizationRequiredError || error instanceof McpAuthRequiredError ? 'needsSignIn' : s.client?.connectionState === 'connected' ? 'degraded' : 'error'
    if ((s.state === 'error' || s.state === 'degraded') && !s.retry) {
      const delay = [1000, 5000, 30_000, 300_000][Math.min(s.failures++, 3)] ?? 300_000
      s.retry = setTimeout(() => { delete s.retry; void connect(id) }, delay)
      s.retry.unref()
    }
    changed()
  }
  const connect = (id: string): Promise<void> => {
    const s = session(id)
    if (s.pending) return s.pending
    if (closed) return Promise.resolve()
    if (s.retry) { clearTimeout(s.retry); delete s.retry }
    s.abort = new AbortController()
    const signal = s.abort.signal
    save({ ...stored(id).config, enabled: true })
    s.state = 'connecting'
    changed()
    s.pending = (async () => {
      const old = s.client
      delete s.client
      await old?.close()
      const config = stored(id).config
      endpoint(config.url)
      const auth = await connectionAuth(config, credentials)
      const client = await clientFor(config, auth)
      if (signal.aborted) { await client.close(); return }
      if (auth) s.auth = auth
      s.client = client
      client.onNotification('notifications/tools/list_changed', () => { void refresh(id).catch((error: unknown) => failed(id, error)) })
      client.onError((error) => { if (s.client === client) failed(id, error) })
      client.onClose(() => { if (s.client === client) failed(id, new Error('Closed')) })
      await refresh(id)
      s.failures = 0
    })().catch((error: unknown) => failed(id, error)).finally(() => { delete s.pending })
    return s.pending
  }
  const disconnect = async (id: string, forget = true, signingIn = false) => {
    const s = session(id)
    s.abort.abort()
    if (forget) store.db.prepare('UPDATE mcp_connections SET epoch = ? WHERE id = ?').run(uuidv7(), id)
    if (s.retry) { clearTimeout(s.retry); delete s.retry }
    await s.client?.close()
    await s.pending
    if (!signingIn) await signIns.get(id)
    delete s.client
    delete s.auth
    save({ ...stored(id).config, enabled: false })
    if (forget) {
      await credentials.clear(id)
    }
    s.state = 'off'
    changed()
  }
  const signIns = new Map<string, Promise<void>>()
  const authorizeOnce = async (id: string) => {
    await disconnect(id, false, true)
    const s = session(id)
    s.abort = new AbortController()
    s.state = 'connecting'
    changed()
    const config = stored(id).config
    try {
      if (config.auth.kind === 'oauth') await signIn(config, credentials, s.abort.signal)
      if (s.abort.signal.aborted) return
      store.db.prepare('UPDATE mcp_connections SET epoch = ? WHERE id = ?').run(uuidv7(), id)
      await connect(id)
    } catch (error) { failed(id, error) }
  }
  const authorize = (id: string): Promise<void> => {
    const active = signIns.get(id)
    if (active) return active
    const pending = authorizeOnce(id).finally(() => { signIns.delete(id) })
    signIns.set(id, pending)
    return pending
  }
  const tool = (id: string, name: string) => {
    const found = catalogue(store, id).find((row) => row.name === name && row.present === 1)
    if (!found) throw new McpError({ reason: 'unavailable', message: 'This tool is not available.' })
    if (denied(name)) throw new McpError({ reason: 'destructive', message: 'Juno does not offer destructive tools.' })
    return found
  }
  const checkSecrets = async (args: unknown) => {
    if (hasSecret(args, await credentials.values())) throw new McpError({ reason: 'secret', message: 'Juno blocked a key or token in these arguments.' })
  }
  /** Trusted adapter boundary only. Model tools must use the read policy or an Executor. */
  const invoke = async (id: string, name: string, args: unknown, write = false) => {
    const initial = tool(id, name)
    const epoch = stored(id).epoch
    const parsed = parseObject(args)
    if (destructiveArguments(parsed)) throw new McpError({ reason: 'destructive', message: 'Juno does not offer destructive operations.' })
    validateArguments(initial.definition, parsed)
    await checkSecrets(parsed)
    const current = tool(id, name)
    if (current.hash !== initial.hash || stored(id).epoch !== epoch || (!write && current.tier !== 0)) throw new McpError({ reason: 'stale', message: 'Review this tool before using it.' })
    const s = session(id)
    if (s.state !== 'ready' || !s.client) throw new McpError({ reason: 'unavailable', message: 'The connection is not ready.' })
    let client = s.client
    try {
      if (write) client = await clientFor(stored(id).config, s.auth, true)
      if (s.abort.signal.aborted || stored(id).epoch !== epoch || tool(id, name).hash !== initial.hash) throw new Error('Connection changed')
      return await client.callTool(name, parsed)
    } catch (error) {
      failed(id, error)
      throw new McpError({ reason: 'unavailable', message: 'The server did not confirm the result.' })
    } finally { if (write && client !== s.client) await client.close() }
  }
  return {
    store, stored, configs, tool, invoke, checkSecrets, connect, disconnect, authorize, refresh,
    /** Owner-only configuration. Replacing an endpoint revokes credentials and old cards. */
    configure: async (input: ConnectionConfig) => {
      const config = Schema.decodeUnknownSync(ConnectionConfig)(input)
      endpoint(config.url)
      if (config.noSecrets && config.auth.kind === 'bearer') throw new McpError({ reason: 'invalid', message: 'Use this server’s own OAuth sign-in.' })
      if (configs().some((row) => row.id === config.id)) await disconnect(config.id)
      store.db.prepare('INSERT INTO mcp_connections (id,config,epoch) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config, epoch=excluded.epoch, discovered=0').run(config.id, JSON.stringify(config), uuidv7())
      store.db.prepare('DELETE FROM mcp_tools WHERE connection_id = ?').run(config.id)
      changed()
    },
    state: (id: string) => session(id).state,
    setTier: (id: string, name: string, hash: string, tier: 0 | 3) => {
      if (tool(id, name).hash !== hash) throw new McpError({ reason: 'stale', message: 'The tool changed. Review its current schema.' })
      store.db.prepare('UPDATE mcp_tools SET tier = ?, changed = 0 WHERE connection_id = ? AND name = ?').run(tier, id, name)
      changed()
    },
    definitions: (id: string) => catalogue(store, id).filter((row) => row.present === 1 && !denied(row.name)).map((row) => ({ ...row, definition: json(JSON.parse(row.definition)) })),
    page: (): ConnectionsPage => ({ connections: configs().map((config) => ({
      id: ConnectionId.make(config.id), label: config.label, enabled: config.enabled,
      state: session(config.id).state, address: config.url,
      ...(session(config.id).state === 'error' || session(config.id).state === 'degraded' ? { detail: 'The connection is unavailable. Juno will reconnect.' } : {}),
      tools: catalogue(store, config.id).filter((row) => row.present === 1).map((row) => ({
        name: row.name, tier: row.tier, schemaHash: row.hash, hint: JSON.stringify(parseObject(JSON.parse(row.definition)).annotations ?? {}), allowlisted: config.allowlist.includes(row.name),
        ...(row.changed === 1 ? { changed: true as const } : {}),
      })),
    })) }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    start: async () => { for (const config of configs()) if (config.enabled) await connect(config.id) },
    close: async () => {
      closed = true
      for (const s of sessions.values()) {
        s.abort.abort()
        if (s.retry) clearTimeout(s.retry)
        await s.client?.close()
        await s.pending
      }
      await Promise.allSettled(signIns.values())
      listeners.clear()
    },
  }
}
export type McpManagerApi = ReturnType<typeof createMcpManager>
export class McpManager extends Context.Service<McpManager, McpManagerApi>()('juno/agent/McpManager') {
  static readonly layer = (options: ManagerOptions) => Layer.effect(McpManager, Effect.acquireRelease(
    Effect.sync(() => createMcpManager(options)),
    (manager) => Effect.promise(() => manager.close()),
  ))
}
