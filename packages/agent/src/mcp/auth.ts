import { McpClient, StreamableHttpTransport, type AuthProvider } from '@earendil-works/pi-mcp'
import { adaptOAuthProvider, authorizeMcp, McpOAuthProvider, OAuthCallbackServer } from '@earendil-works/pi-mcp/oauth'
import type { ConnectionConfig, Credentials } from './types'

/** Writes omit onUnauthorized: even a 401 must not replay an authorized tool call. */
export async function clientFor(config: ConnectionConfig, auth: AuthProvider | undefined, write = false): Promise<McpClient> {
  const client = new McpClient({ name: 'Juno', version: '1.0.0', requestTimeoutMs: 30_000 })
  try {
    await client.connect(new StreamableHttpTransport({
      url: config.url, maxMessageBytes: 1_000_000, reconnect: { maxRetries: 0 }, openGetStream: !write,
      ...(auth ? { authProvider: write ? { token: () => auth.token() } : auth } : {}),
      // Never forward credentials through an HTTP redirect.
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
    }))
    return client
  } catch (error) {
    await client.close()
    throw error
  }
}

export async function connectionAuth(config: ConnectionConfig, credentials: Credentials): Promise<AuthProvider | undefined> {
  if (config.auth.kind === 'none') return undefined
  if (config.auth.kind === 'bearer') {
    const ref = config.auth.secretRef
    return { token: () => credentials.bearer(ref) }
  }
  const provider = new McpOAuthProvider({
    serverUrl: config.url, redirectUrl: 'http://127.0.0.1:1/callback',
    clientMetadata: { client_name: 'Juno' }, store: credentials.oauth(config.id),
    // Background reconnects never open a browser. Only an owner click does.
    onRedirect: () => {},
  })
  return adaptOAuthProvider(provider)
}

export async function signIn(config: ConnectionConfig, credentials: Credentials, signal: AbortSignal): Promise<void> {
  const callback = await OAuthCallbackServer.listen({ host: '127.0.0.1', timeoutMs: 120_000 })
  const abort = () => { void callback.close() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (signal.aborted) throw new Error('Cancelled')
    let authorization: URL | undefined
    const provider = new McpOAuthProvider({
      serverUrl: config.url, redirectUrl: callback.redirectUrl,
      clientMetadata: { client_name: 'Juno' }, store: credentials.oauth(config.id),
      onRedirect: (url) => { authorization = url },
    })
    // A random loopback port needs a fresh registration with its exact redirect URI.
    await provider.invalidateCredentials('all')
    await authorizeMcp(provider, { serverUrl: config.url, signal })
    if (!authorization) throw new Error('No authorization URL')
    const response = callback.waitForCallback(await provider.state())
    // Attach the rejection handler before opening the browser or cancelling.
    const completed = response.then(async ({ code, iss }) => {
      if (signal.aborted) throw new Error('Cancelled')
      await authorizeMcp(provider, { serverUrl: config.url, authorizationCode: code, signal, ...(iss ? { iss } : {}) })
    })
    await Promise.all([completed, credentials.openAuthorization(authorization.href)])
  } finally {
    signal.removeEventListener('abort', abort)
    await callback.close()
  }
}
