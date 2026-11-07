/**
 * The keychain and browser bridge for Juno Agent's MCP connections (WP17).
 * The agent's MCP manager asks for a connection's OAuth state by id
 * (`CredentialRequest`); main keeps it in the login keychain and nowhere
 * else: never a file, a log or the renderer.
 *
 * A state is JSON (tokens, the dynamic client registration, PKCE verifier).
 * `security -i` reads one line of at most about 4 KB, so the state goes in
 * base64 chunks of `CHUNK` characters: generic passwords `<id>.0`, `<id>.1`,
 * ... under the service `juno-mcp`, and `<id>` holds the chunk count. Writes
 * to one connection run one at a time, so a save and a clear never interleave.
 * A save drops the count before it writes the chunks and sets it last, so a
 * save that stops part way (a kill, a locked keychain) leaves no state, never
 * a mix of old and new chunks: the agent signs the connection in again.
 *
 * `open` shows an authorization URL in the system browser. pi-mcp finishes
 * sign-in only on a loopback redirect, which the agent listens on. Under
 * `JUNO_E2E` the keychain is in memory and `open` fetches the URL instead:
 * the fake authorization server approves at once and redirects to that
 * loopback callback.
 */
import type { CredentialRequest } from '@juno/agent-contract'
import { macKeychain, memoryKeychain, type Keychain, type KeychainItem } from './keychain'

export const MCP_SERVICE = 'juno-mcp'
const CHUNK = 3000
const MAX_CHUNKS = 32
/** Connection ids are Juno's own (`notion`, `server-<uuid>`). Anything else is refused before it reaches `security`. */
const ID = /^[a-z0-9-]{1,64}$/

export interface McpCredentialsOptions {
  /** One keychain item per account under `MCP_SERVICE`. */
  readonly keychain: (item: KeychainItem) => Keychain
  /** Opens a checked authorization URL. */
  readonly open: (url: string) => Promise<void>
}

export function mcpCredentials({ keychain, open }: McpCredentialsOptions) {
  const item = (account: string) => keychain({ service: MCP_SERVICE, account })
  const queues = new Map<string, Promise<unknown>>()
  const serial = <A>(id: string, run: () => Promise<A>): Promise<A> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(run, run)
    const settled = next.catch(() => undefined)
    queues.set(id, settled)
    void settled.then(() => { if (queues.get(id) === settled) queues.delete(id) })
    return next
  }
  const count = async (id: string) => {
    const raw = await item(id).read()
    const n = raw === undefined ? 0 : Number(raw)
    return Number.isInteger(n) && n >= 0 && n <= MAX_CHUNKS ? n : 0
  }
  const load = async (id: string): Promise<string | null> => {
    const n = await count(id)
    if (n === 0) return null
    const parts: string[] = []
    for (let index = 0; index < n; index++) {
      const part = await item(`${id}.${index}`).read()
      if (part === undefined) return null
      parts.push(part)
    }
    return Buffer.from(parts.join(''), 'base64').toString('utf8')
  }
  const save = async (id: string, state: string) => {
    const encoded = Buffer.from(state, 'utf8').toString('base64')
    const parts = encoded.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? []
    if (parts.length === 0 || parts.length > MAX_CHUNKS) throw new Error('state too large')
    const before = await count(id)
    if (before > 0) await item(id).remove()
    for (const [index, part] of parts.entries()) await item(`${id}.${index}`).write(part)
    await item(id).write(String(parts.length))
    for (let index = parts.length; index < before; index++) await item(`${id}.${index}`).remove()
  }
  const clear = async (id: string) => {
    const n = await count(id)
    await item(id).remove()
    for (let index = 0; index < n; index++) await item(`${id}.${index}`).remove()
  }
  /** What main answers: the loaded state for `load`, else nothing. Throws on a refused request. */
  return async (request: CredentialRequest): Promise<string | null | undefined> => {
    if (request._tag === 'open') {
      if (!isAuthorizationUrl(request.url)) throw new Error('refused')
      await open(request.url)
      return undefined
    }
    if (!ID.test(request.id)) throw new Error('refused')
    switch (request._tag) {
      case 'load': return serial(request.id, () => load(request.id))
      case 'save': await serial(request.id, () => save(request.id, request.state)); return undefined
      case 'clear': await serial(request.id, () => clear(request.id)); return undefined
    }
  }
}

/** https, or http on this Mac (a local server's sign-in page). Nothing else opens. */
export function isAuthorizationUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  } catch {
    return false
  }
}

/** The app's bridge: the login keychain and the system browser, or memory and a fetch under tests. */
export function appMcpCredentials(e2e: boolean, openExternal: (url: string) => Promise<void>) {
  if (!e2e) return mcpCredentials({ keychain: (item) => macKeychain(item), open: openExternal })
  const items = new Map<string, Keychain>()
  return mcpCredentials({
    keychain: ({ account }) => {
      let found = items.get(account)
      if (!found) items.set(account, (found = memoryKeychain()))
      return found
    },
    open: async (url) => {
      await fetch(url)
    },
  })
}
