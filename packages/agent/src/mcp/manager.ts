import { Context, Effect, Layer, Schema } from 'effect'
import { McpAuthRequiredError, type AuthProvider, type McpClient } from '@earendil-works/pi-mcp'
import { McpOAuthAuthorizationRequiredError } from '@earendil-works/pi-mcp/oauth'
import { ConnectionId, ReviewRule, type ConnectionsPage, type ConnectionState } from '@juno/agent-contract'
import { uuidv7, type Store } from '../store/store'
import { catalogue, discover, json, parseObject, validateArguments } from './catalogue'
import { clientFor, connectionAuth, signIn } from './auth'
import { ConnectionConfig, McpError, PRESETS, T3, destructiveArguments, endpoint, forbidden, hasSecret, type Credentials } from './types'

const Stored = Schema.Struct({ config: Schema.String, epoch: Schema.String, discovered: Schema.Number, active_url: Schema.NullOr(Schema.String), review: ReviewRule })
interface Session {
  state: ConnectionState
  client?: McpClient
  auth?: AuthProvider
  address?: string
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

export function createMcpManager({ store, credentials, defaults = PRESETS }: ManagerOptions) {
  const sessions = new Map<string, Session>()
  const listeners = new Set<() => void>()
  let closed = false
  const changed = () => { for (const listener of listeners) listener() }
  const stored = (id: string) => {
    const raw = store.db.prepare('SELECT config, epoch, discovered, active_url, review FROM mcp_connections WHERE id = ?').get(id)
    if (!raw) throw new McpError({ reason: 'invalid', message: 'Unknown connection.' })
    const row = Schema.decodeUnknownSync(Stored)(raw)
    return { ...row, config: Schema.decodeUnknownSync(ConnectionConfig)(JSON.parse(row.config)) }
  }
  const configs = () => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(store.db.prepare('SELECT id FROM mcp_connections ORDER BY rowid').all()).map(({ id }) => stored(id).config)
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
    endpoint(config.url, config.allowNetwork, config.id === 't3')
    if (config.noSecrets && config.auth.kind === 'bearer') throw new McpError({ reason: 'invalid', message: 'This connection requires its own OAuth sign-in.' })
    store.db.prepare('INSERT OR IGNORE INTO mcp_connections (id,config,epoch) VALUES (?,?,?)').run(config.id, JSON.stringify(config), uuidv7())
    // A preset's read list belongs to the code, not the stored row: an older build's guess must not
    // make a tool a read, and a name the code drops is reviewed again. Reads are derived (`isRead`).
    const saved = stored(config.id).config
    if (saved.allowlist.join('\n') !== config.allowlist.join('\n')) save({ ...saved, allowlist: config.allowlist })
  }
  const refresh = async (id: string) => {
    const s = session(id)
    const client = s.client
    if (!client) throw new McpError({ reason: 'unavailable', message: 'Connect the server first.' })
    const tools = await client.listTools()
    if (s.abort.signal.aborted || s.client !== client) return
    const row = stored(id)
    discover(store, row.config, tools)
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
      endpoint(config.url, config.allowNetwork, config.id === 't3')
      let selected = config
      if (id === 't3') {
        const local = new URL(config.url)
        local.protocol = 'http:'
        local.hostname = '127.0.0.1'
        local.pathname = '/mcp'
        const candidate = { ...config, url: local.href }
        try {
          // Probe without credentials. A sign-in challenge still identifies the local endpoint.
          const probe = await clientFor(candidate, undefined)
          await probe.close()
          selected = candidate
        } catch (error) {
          if (error instanceof McpOAuthAuthorizationRequiredError || error instanceof McpAuthRequiredError) selected = candidate
        }
      }
      if (selected.url !== (stored(id).active_url ?? config.url)) {
        await credentials.clear(id)
        store.db.prepare('UPDATE mcp_connections SET epoch = ? WHERE id = ?').run(uuidv7(), id)
      }
      store.db.prepare('UPDATE mcp_connections SET active_url = ? WHERE id = ?').run(selected.url, id)
      s.address = selected.url
      const auth = await connectionAuth(selected, credentials)
      const client = await clientFor(selected, auth)
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
    const s = session(id)
    try {
      // Stored credentials first: Connect opens the browser only when the server asks for a sign-in.
      await connect(id)
      if (s.abort.signal.aborted || s.state !== 'needsSignIn') return
      const current = stored(id).config
      // A server added by address starts without auth; its 401 means it wants OAuth.
      const config = current.auth.kind === 'none' ? { ...current, auth: { kind: 'oauth' as const } } : current
      if (config !== current) save(config)
      if (config.auth.kind !== 'oauth') return
      await disconnect(id, false, true)
      s.abort = new AbortController()
      s.state = 'connecting'
      changed()
      await signIn({ ...config, url: s.address ?? config.url }, credentials, s.abort.signal)
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
    // A tool the owner turned off, or one that merges, buys or force-pushes, is not offered, and is never called.
    const found = catalogue(store, id).find((row) => row.name === name && row.present === 1 && row.enabled === 1 && row.lock !== 'forbidden')
    if (!found) throw new McpError({ reason: 'unavailable', message: 'This tool is not available.' })
    return found
  }
  const checkSecrets = async (args: unknown) => {
    if (hasSecret(args, await credentials.values())) throw new McpError({ reason: 'secret', message: 'Juno blocked a key or token in these arguments.' })
  }
  /**
   * Trusted adapter boundary only. Model tools must use the read policy or an Executor. `hinted`: a
   * tool the server marked read-only, which the caller has checked may run as a read (SPEC 13.9).
   */
  const invoke = async (id: string, name: string, args: unknown, access: 'read' | 'hinted' | 'write' = 'read') => {
    const write = access === 'write'
    const initial = tool(id, name)
    const epoch = stored(id).epoch
    const parsed = parseObject(args)
    validateArguments(initial.definition, parsed)
    if (destructiveArguments(parsed, forbidden)) throw new McpError({ reason: 'forbidden', message: 'Juno does not merge, buy or force-push.' })
    await checkSecrets(parsed)
    const current = tool(id, name)
    const readable = current.tier === 0 || (access === 'hinted' && current.hinted)
    if (current.hash !== initial.hash || stored(id).epoch !== epoch || (!write && !readable)) throw new McpError({ reason: 'stale', message: 'Review this tool before using it.' })
    const s = session(id)
    if (s.state !== 'ready' || !s.client) throw new McpError({ reason: 'unavailable', message: 'The connection is not ready.' })
    let client = s.client
    try {
      if (write) client = await clientFor({ ...stored(id).config, url: s.address ?? stored(id).config.url }, s.auth, true)
      if (s.abort.signal.aborted || stored(id).epoch !== epoch || tool(id, name).hash !== initial.hash) throw new Error('Connection changed')
      return await client.callTool(name, parsed)
    } catch (error) {
      failed(id, error)
      throw new McpError({ reason: 'unavailable', message: 'The server did not confirm the result.' })
    } finally { if (write && client !== s.client) await client.close() }
  }
  /** Owner-only configuration. Replacing an endpoint revokes credentials and old cards. */
  const configure = async (input: ConnectionConfig) => {
    const config = Schema.decodeUnknownSync(ConnectionConfig)(input)
    endpoint(config.url, config.allowNetwork, config.id === 't3')
    if (config.noSecrets && config.auth.kind === 'bearer') throw new McpError({ reason: 'invalid', message: 'Use this server’s own OAuth sign-in.' })
    if (configs().some((row) => row.id === config.id)) await disconnect(config.id)
    store.db.prepare('INSERT INTO mcp_connections (id,config,epoch) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config, epoch=excluded.epoch, discovered=0, active_url=NULL').run(config.id, JSON.stringify(config), uuidv7())
    store.db.prepare('DELETE FROM mcp_tools WHERE connection_id = ?').run(config.id)
    changed()
  }
  const presets = new Set(defaults.map((config) => config.id))
  return {
    store, stored, configs, tool, invoke, checkSecrets, connect, disconnect, authorize, refresh,
    configure,
    /** Another server by address. It starts off and without auth; Connect finds out whether it needs a sign-in. */
    add: async (label: string, url: string) => {
      const href = endpoint(url.trim())
      const name = label.trim() === '' ? new URL(href).host : label.trim()
      await configure({ id: `server-${uuidv7()}`, label: name.slice(0, 80), url: href, transport: 'http', auth: { kind: 'none' }, trusted: false, noSecrets: false, allowlist: [], enabled: false })
    },
    /** Only a server the owner added can be removed. Its credentials go with it. */
    remove: async (id: string) => {
      if (presets.has(id)) throw new McpError({ reason: 'invalid', message: 'This connection cannot be removed.' })
      await disconnect(id)
      store.db.prepare('DELETE FROM mcp_tools WHERE connection_id = ?').run(id)
      store.db.prepare('DELETE FROM mcp_connections WHERE id = ?').run(id)
      sessions.delete(id)
      changed()
    },
    /** T3 Code's address. A new address is a new connection: it signs in again. */
    address: async (url: string, allowNetwork: boolean) => {
      const config = stored(T3.id).config
      const href = endpoint(url.trim(), allowNetwork, true)
      if (href === config.url && allowNetwork === (config.allowNetwork ?? false)) return
      await configure({ ...config, url: href, allowNetwork, enabled: false })
    },
    state: (id: string) => session(id).state,
    /** The owner's switch and auto-review rule for one tool (Settings › Connections › Configure). */
    setTool: (id: string, name: string, change: { readonly enabled?: boolean; readonly review?: ReviewRule }) => {
      const found = catalogue(store, id).find((row) => row.name === name && row.present === 1)
      if (!found) throw new McpError({ reason: 'stale', message: 'This tool is not available.' })
      if (change.review !== undefined && found.lock !== undefined) throw new McpError({ reason: 'invalid', message: 'This tool always asks.' })
      // Setting a rule on the tool is the owner looking at it again: it is no longer new or changed for the rule.
      store.db.prepare('UPDATE mcp_tools SET enabled = ?, review = ?, fresh = ? WHERE connection_id = ? AND name = ?')
        .run(change.enabled === undefined ? found.enabled : change.enabled ? 1 : 0, change.review ?? found.review, change.review === undefined ? found.fresh : 0, id, name)
      changed()
    },
    /** The connection's own rule, for its tools that have none. Every tool of it then follows it again. */
    setRule: (id: string, review: ReviewRule) => {
      stored(id)
      store.db.prepare('UPDATE mcp_connections SET review = ? WHERE id = ?').run(review, id)
      store.db.prepare('UPDATE mcp_tools SET fresh = 0 WHERE connection_id = ?').run(id)
      changed()
    },
    /**
     * The rule a call to this tool follows (SPEC 13.9): Always ask for a delete; else the tool's own;
     * else the connection's, except that a new or changed tool does not follow its Never ask.
     */
    rule: (id: string, name: string): ReviewRule => {
      const found = tool(id, name)
      if (found.lock !== undefined) return 'always'
      if (found.review !== 'auto') return found.review
      const connection = stored(id).review
      return found.fresh === 1 && connection === 'never' ? 'auto' : connection
    },
    /**
     * The name the model uses for a connection: a preset's id, or a short slug of the label the
     * owner gave a server they added. Never its internal id, address or anything else.
     */
    handles: (): ReadonlyMap<string, string> => {
      const names = new Map<string, string>()
      for (const config of configs()) {
        const base = presets.has(config.id) ? config.id : config.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'server'
        let name = base
        for (let n = 2; names.has(name); n++) name = `${base}-${n}`
        names.set(name, config.id)
      }
      return names
    },
    /** What the model is offered: present tools the owner has not turned off. */
    definitions: (id: string) => catalogue(store, id).filter((row) => row.present === 1 && row.enabled === 1 && row.lock !== 'forbidden').map((row) => ({ ...row, definition: json(JSON.parse(row.definition)) })),
    page: (): ConnectionsPage => ({ connections: configs().map((config) => ({
      id: ConnectionId.make(config.id), label: config.label, enabled: config.enabled,
      state: session(config.id).state, address: session(config.id).address ?? config.url, review: stored(config.id).review,
      ...(config.id === T3.id ? { t3: { url: config.url, allowNetwork: config.allowNetwork ?? false } } : {}),
      ...(presets.has(config.id) ? {} : { removable: true as const }),
      ...(session(config.id).state === 'error' || session(config.id).state === 'degraded' ? { detail: 'The connection is unavailable. Juno will reconnect.' } : {}),
      tools: catalogue(store, config.id).filter((row) => row.present === 1).map((row) => ({
        name: row.name, read: row.tier === 0, schemaHash: row.hash, ...hintOf(row.definition), enabled: row.enabled === 1, review: row.review,
        ...(row.hinted ? { readOnly: true as const } : {}),
        ...(row.changed === 1 ? { changed: true as const } : row.fresh === 1 ? { added: true as const } : {}),
        ...(row.lock === undefined ? {} : { locked: row.lock }),
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
/** The server's own one line about a tool, shown and never trusted. */
export function hintOf(definition: string): { hint?: string } {
  const tool = parseObject(JSON.parse(definition))
  const first = typeof tool.description === 'string' ? tool.description.split('\n')[0]?.trim().slice(0, 200) ?? '' : ''
  // Some servers repeat the name as the description; it says nothing new.
  return first === '' || first === tool.name ? {} : { hint: first }
}
export type McpManagerApi = ReturnType<typeof createMcpManager>
export class McpManager extends Context.Service<McpManager, McpManagerApi>()('juno/agent/McpManager') {
  static readonly layer = (options: ManagerOptions) => Layer.effect(McpManager, Effect.acquireRelease(
    Effect.sync(() => createMcpManager(options)),
    (manager) => Effect.promise(() => manager.close()),
  ))
}
