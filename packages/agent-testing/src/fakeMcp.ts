/**
 * A fake MCP server over Streamable HTTP on loopback, with JSON responses.
 * pi-mcp has no server side, so this is a small JSON-RPC handler: initialize,
 * tools/list (one page) and tools/call. A server with `bearer` set answers 401
 * to any request without that token, as Juno's own loopback server does for
 * Codex (plan v3 §7.2).
 *
 * WP10 grows it into the Notion, Littlebird and T3 fakes: OAuth, pagination,
 * list_changed, schema changes, lost writes and a missing tool.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export interface FakeTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: { readonly type: 'object'; readonly properties?: Record<string, unknown>; readonly required?: ReadonlyArray<string> }
  /** The tool's answer, as MCP text content. Throwing returns an MCP tool error. */
  readonly call: (args: Record<string, unknown>) => string | Promise<string>
}

export interface FakeMcpOptions {
  readonly name?: string
  readonly tools: ReadonlyArray<FakeTool>
  readonly bearer?: string
}

export interface FakeMcpServer {
  readonly url: string
  /** Every tools/call, in order. */
  readonly calls: ReadonlyArray<{ readonly name: string; readonly args: Record<string, unknown> }>
  /** Requests refused for a missing or wrong bearer token. */
  readonly rejected: () => number
  readonly close: () => Promise<void>
}

type JsonRpcRequest = { readonly jsonrpc: '2.0'; readonly id?: string | number; readonly method: string; readonly params?: Record<string, any> }

const result = (id: JsonRpcRequest['id'], value: unknown) => ({ jsonrpc: '2.0', id, result: value })
const failure = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

export async function startFakeMcpServer(options: FakeMcpOptions): Promise<FakeMcpServer> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let rejected = 0

  const answer = async (request: JsonRpcRequest) => {
    switch (request.method) {
      case 'initialize':
        return result(request.id, {
          protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name ?? 'fake-mcp', version: '0.0.0' },
        })
      case 'ping':
        return result(request.id, {})
      case 'tools/list':
        return result(request.id, {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          })),
        })
      case 'tools/call': {
        const name = String(request.params?.name)
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>
        const tool = options.tools.find((candidate) => candidate.name === name)
        if (!tool) return failure(request.id, -32602, `unknown tool ${name}`)
        calls.push({ name, args })
        try {
          return result(request.id, { content: [{ type: 'text', text: await tool.call(args) }] })
        } catch (error) {
          return result(request.id, { content: [{ type: 'text', text: (error as Error).message }], isError: true })
        }
      }
      default:
        return failure(request.id, -32601, `method not found: ${request.method}`)
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (options.bearer !== undefined && req.headers.authorization !== `Bearer ${options.bearer}`) {
      rejected++
      res.writeHead(401).end()
      return
    }
    if (req.method !== 'POST') {
      // No server-to-client stream: the client falls back to request responses.
      res.writeHead(405).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body) as JsonRpcRequest
    if (request.id === undefined) {
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(await answer(request)))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    rejected: () => rejected,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
