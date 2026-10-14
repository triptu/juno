// Signs in to a fake OAuth server through pi-mcp's real client, the way
// Juno's MCP manager will: connect, get sent to the authorization URL, have
// the owner approve, exchange the code, connect again.
import { McpClient, StreamableHttpTransport, type McpFetch } from '@earendil-works/pi-mcp'
import { adaptOAuthProvider, authorizeMcp, McpOAuthAuthorizationRequiredError, McpOAuthProvider, MemoryOAuthStateStore } from '@earendil-works/pi-mcp/oauth'
import type { FakeOAuth } from '../src/index'

export interface Session {
  readonly provider: McpOAuthProvider
  readonly store: MemoryOAuthStateStore
  /** The authorization URLs the provider was sent to, in order. */
  readonly redirects: URL[]
  readonly connect: () => Promise<McpClient>
}

export function session(url: string, fetch?: McpFetch): Session {
  const redirects: URL[] = []
  const store = new MemoryOAuthStateStore()
  const provider = new McpOAuthProvider({
    serverUrl: url,
    redirectUrl: 'http://127.0.0.1:1/callback',
    clientMetadata: { client_name: 'Juno (test)' },
    store,
    onRedirect: (target) => void redirects.push(target),
  })
  const connect = async () => {
    const client = new McpClient({ name: 'juno-test', version: '0.0.0' })
    await client.connect(new StreamableHttpTransport({ url, openGetStream: false, authProvider: adaptOAuthProvider(provider), ...(fetch ? { fetch } : {}) }))
    return client
  }
  return { provider, store, redirects, connect }
}

/** Runs the whole sign-in and returns a connected client. */
export async function signIn(url: string, oauth: FakeOAuth, fetch?: McpFetch): Promise<Session & { client: McpClient; code: string }> {
  const s = session(url, fetch)
  await s.connect().then(
    () => { throw new Error('connected without signing in') },
    (error) => { if (!(error instanceof McpOAuthAuthorizationRequiredError)) throw error },
  )
  const callback = oauth.approve(s.redirects.at(-1)!)
  const code = callback.searchParams.get('code')!
  await authorizeMcp(s.provider, { serverUrl: url, authorizationCode: code, ...(fetch ? { fetch } : {}) })
  return { ...s, client: await s.connect(), code }
}
