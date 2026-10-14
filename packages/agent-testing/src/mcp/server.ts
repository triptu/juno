/**
 * A generic fake MCP server: a tool list on loopback Streamable HTTP, and the
 * same handler on pi-mcp's in-memory transport. The Notion, Littlebird and T3
 * fakes are built on it; use it directly for Juno's own loopback server's
 * clients (Codex) or any one-off server.
 */
import type { McpTransport } from '@earendil-works/pi-mcp'
import { createHandler, type FakeTool, type McpHandler, type ToolCallRecord } from './handler'
import { listen, type HttpAuth } from './http'
import { connectInMemory } from './memory'
import { createOAuthServer, type FakeOAuth, type OAuthOptions } from './oauth'

export interface FakeMcpOptions {
  readonly name?: string
  readonly tools: ReadonlyArray<FakeTool>
  /** Every request needs `Authorization: Bearer <bearer>`, as Juno's server for Codex does (plan v3 §7.2). */
  readonly bearer?: string
  /** Every request needs a token from the fake OAuth server. */
  readonly oauth?: OAuthOptions
  /** Tools per `tools/list` page. */
  readonly pageSize?: number
  readonly port?: number
}

export interface FakeMcpServer {
  /** `http://127.0.0.1:<port>/mcp`. */
  readonly url: string
  readonly origin: string
  /** Every tools/call, in order, whichever transport carried it. */
  readonly calls: ReadonlyArray<ToolCallRecord>
  /** HTTP requests refused with 401. */
  readonly rejected: () => number
  readonly tools: () => ReadonlyArray<FakeTool>
  /** Replaces the tool list and sends `notifications/tools/list_changed` to every open event stream. */
  readonly setTools: (tools: ReadonlyArray<FakeTool>) => void
  /**
   * The next call of `tool` is lost: HTTP closes the connection, in-memory
   * never answers. With `applied` (the default) the tool ran first.
   */
  readonly loseNextCall: McpHandler['loseNextCall']
  /** Present when the server uses OAuth. */
  readonly oauth: FakeOAuth | undefined
  /** A new in-memory client transport to the same handler, with no auth. */
  readonly connectInMemory: () => McpTransport
  readonly close: () => Promise<void>
}

export async function startFakeMcpServer(options: FakeMcpOptions): Promise<FakeMcpServer> {
  const handler = createHandler({ name: options.name ?? 'fake-mcp', tools: options.tools, ...(options.pageSize ? { pageSize: options.pageSize } : {}) })
  const oauth = options.oauth ? createOAuthServer(options.oauth) : undefined
  const auth: HttpAuth = oauth ? { kind: 'oauth', server: oauth } : options.bearer !== undefined ? { kind: 'bearer', token: options.bearer } : { kind: 'none' }
  const http = await listen(handler, { auth, ...(options.port ? { port: options.port } : {}) })
  return {
    url: http.url,
    origin: http.origin,
    calls: handler.calls,
    rejected: http.rejected,
    tools: handler.tools,
    setTools: handler.setTools,
    loseNextCall: handler.loseNextCall,
    oauth,
    connectInMemory: () => connectInMemory(handler),
    close: http.close,
  }
}
