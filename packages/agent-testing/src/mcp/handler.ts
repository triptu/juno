/**
 * The MCP server side the fakes share. pi-mcp has no server, so this is a
 * small JSON-RPC handler: initialize, ping, paginated tools/list and
 * tools/call, plus `notifications/tools/list_changed` when the tool list
 * changes. `http.ts` and `memory.ts` put it on a transport.
 */
import type { JsonRpcMessage, Tool } from '@earendil-works/pi-mcp'

export interface ToolResult {
  /** MCP text content. */
  readonly text: string
  readonly structuredContent?: unknown
}

export interface FakeTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Tool['inputSchema']
  readonly annotations?: Tool['annotations']
  /**
   * The tool's answer. A string becomes MCP text content. Throwing returns an
   * MCP tool error (`isError: true`) with the error's message.
   */
  readonly call: (args: Record<string, unknown>) => string | ToolResult | Promise<string | ToolResult>
}

export interface HandlerOptions {
  readonly name: string
  readonly tools: ReadonlyArray<FakeTool>
  /** Tools per `tools/list` page. Default: all on one page. */
  readonly pageSize?: number
}

export interface ToolCallRecord {
  readonly name: string
  readonly args: Record<string, unknown>
}

/** How a transport answers one request. `drop` means: the server did the work, but the answer never arrives. */
export type Answer = { readonly kind: 'reply'; readonly message: JsonRpcMessage } | { readonly kind: 'none' } | { readonly kind: 'drop' }

export interface McpHandler {
  readonly name: string
  readonly answer: (message: JsonRpcMessage) => Promise<Answer>
  readonly tools: () => ReadonlyArray<FakeTool>
  /** Replaces the tool list and notifies connected clients with `list_changed`. */
  readonly setTools: (tools: ReadonlyArray<FakeTool>) => void
  /** Listens for server-to-client notifications. Returns the unsubscribe. */
  readonly subscribe: (send: (message: JsonRpcMessage) => void) => () => void
  /**
   * The next call of `tool` is lost: with `applied` (the default) the tool runs
   * and only its answer is lost; without, the call never reaches the tool.
   */
  readonly loseNextCall: (tool: string, options?: { readonly applied?: boolean }) => void
  readonly calls: ReadonlyArray<ToolCallRecord>
}

type Request = { readonly jsonrpc: '2.0'; readonly id?: string | number; readonly method: string; readonly params?: Record<string, unknown> }

const reply = (id: Request['id'], result: unknown): Answer => ({ kind: 'reply', message: { jsonrpc: '2.0', id: id!, result } as JsonRpcMessage })
const failure = (id: Request['id'], code: number, message: string): Answer => ({ kind: 'reply', message: { jsonrpc: '2.0', id: id!, error: { code, message } } as JsonRpcMessage })

export function createHandler(options: HandlerOptions): McpHandler {
  let tools = [...options.tools]
  const calls: ToolCallRecord[] = []
  const listeners = new Set<(message: JsonRpcMessage) => void>()
  const lose = new Map<string, boolean>()

  const answer = async (message: JsonRpcMessage): Promise<Answer> => {
    const request = message as Request
    if (request.id === undefined || typeof request.method !== 'string') return { kind: 'none' }
    switch (request.method) {
      case 'initialize':
        return reply(request.id, {
          protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: options.name, version: '0.0.0' },
        })
      case 'ping':
        return reply(request.id, {})
      case 'tools/list': {
        const size = options.pageSize ?? tools.length
        const start = Number(request.params?.cursor ?? 0)
        const page = tools.slice(start, start + size).map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        }))
        const next = start + size < tools.length ? { nextCursor: String(start + size) } : {}
        return reply(request.id, { tools: page, ...next })
      }
      case 'tools/call': {
        const name = String(request.params?.name)
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>
        const tool = tools.find((candidate) => candidate.name === name)
        if (!tool) return failure(request.id, -32602, `Unknown tool: ${name}`)
        const lost = lose.get(name)
        lose.delete(name)
        if (lost === false) return { kind: 'drop' }
        calls.push({ name, args })
        let result: unknown
        try {
          const value = await tool.call(args)
          const { text, structuredContent } = typeof value === 'string' ? { text: value, structuredContent: undefined } : value
          result = { content: [{ type: 'text', text }], ...(structuredContent !== undefined ? { structuredContent } : {}) }
        } catch (error) {
          result = { content: [{ type: 'text', text: (error as Error).message }], isError: true }
        }
        if (lost) return { kind: 'drop' }
        return reply(request.id, result)
      }
      default:
        return failure(request.id, -32601, `Method not found: ${request.method}`)
    }
  }

  return {
    name: options.name,
    answer,
    tools: () => tools,
    setTools: (next) => {
      tools = [...next]
      for (const send of listeners) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' } as JsonRpcMessage)
    },
    subscribe: (send) => {
      listeners.add(send)
      return () => listeners.delete(send)
    },
    loseNextCall: (tool, lost) => lose.set(tool, lost?.applied ?? true),
    calls,
  }
}

/** JSON text and structured content for a tool that returns data. */
export const json = (value: unknown): ToolResult => ({ text: JSON.stringify(value), structuredContent: value })
