// S8 and the pi-mcp spike: Streamable HTTP, OAuth discovery and the start of the flow, against
// T3 Code (loopback first, then the LAN address) and Littlebird. Read-only: no tool is called,
// no login is completed. Dynamic client registration does run, because it is the first step
// of the flow. Prints no client ids, tokens or URL parameter values.
// Run: node docs/juno-agent/spikes/s8-mcp.ts
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import {
  adaptOAuthProvider,
  discoverOAuthServerInfo,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
  OAuthCallbackServer,
} from '@earendil-works/pi-mcp/oauth'

const servers = [
  { label: 'T3 Code (loopback)', url: 'http://127.0.0.1:3773/mcp' },
  { label: 'T3 Code (LAN)', url: 'http://192.168.1.22:3773/mcp' },
  { label: 'Littlebird', url: 'https://mcp.littlebird.ai/mcp' },
]

const paramNames = (url: URL) => [...url.searchParams.keys()].sort().join(',')

async function probe(label: string, url: string) {
  console.log(`\n== ${label}: ${url}`)

  // 1. Plain connect, no auth.
  try {
    const client = new McpClient({ name: 'juno-spike', version: '0.0.0' })
    await client.connect(new StreamableHttpTransport({ url, openGetStream: false }))
    const tools = await client.listTools()
    console.log(`connect without auth: ok, ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)
    await client.close()
    return
  } catch (error) {
    console.log(`connect without auth: ${(error as Error).name}: ${(error as Error).message.slice(0, 160)}`)
  }

  // 2. Discovery.
  try {
    const info = await discoverOAuthServerInfo(url)
    const meta = info.authorizationServerMetadata
    console.log(
      `discovery: auth server ${info.authorizationServerUrl}; grants ${JSON.stringify(meta?.grant_types_supported)}; ` +
        `registration ${meta?.registration_endpoint ? 'yes' : 'no'}; PKCE ${JSON.stringify(meta?.code_challenge_methods_supported)}; ` +
        `scopes ${JSON.stringify(info.resourceMetadata?.scopes_supported ?? meta?.scopes_supported)}`,
    )
  } catch (error) {
    console.log(`discovery: ${(error as Error).name}: ${(error as Error).message.slice(0, 160)}`)
  }

  // 3. Start the flow with pi-mcp's provider and stop at the authorization URL.
  const callback = await OAuthCallbackServer.listen()
  let authorizationUrl: URL | undefined
  const store = new MemoryOAuthStateStore()
  const oauth = new McpOAuthProvider({
    serverUrl: url,
    redirectUrl: callback.redirectUrl,
    clientMetadata: { client_name: 'Juno (spike)' },
    store,
    onRedirect: (target) => {
      authorizationUrl = target
    },
  })
  try {
    const client = new McpClient({ name: 'juno-spike', version: '0.0.0' })
    await client.connect(new StreamableHttpTransport({ url, openGetStream: false, authProvider: adaptOAuthProvider(oauth) }))
    console.log('flow: connected without a login (unexpected)')
    await client.close()
  } catch (error) {
    if (error instanceof McpOAuthAuthorizationRequiredError && authorizationUrl) {
      const registered = (await oauth.clientInformation()) !== undefined
      console.log(
        `flow: started. Dynamic registration ${registered ? 'ok' : 'missing'}. Authorization URL ${authorizationUrl.origin}${authorizationUrl.pathname} ` +
          `with params [${paramNames(authorizationUrl)}]. Stopped before the login.`,
      )
    } else {
      console.log(`flow: ${(error as Error).name}: ${(error as Error).message.slice(0, 200)}`)
    }
  } finally {
    await callback.close()
  }
}

for (const { label, url } of servers) await probe(label, url)
