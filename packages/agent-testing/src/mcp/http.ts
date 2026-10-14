/**
 * Puts an MCP handler on Streamable HTTP: POST `/mcp` answers with JSON, GET
 * `/mcp` opens the server-to-client event stream that carries `list_changed`,
 * and DELETE ends a session. Optional auth: a fixed bearer token, or the fake
 * OAuth server, whose discovery and token endpoints share the listener.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { JsonRpcMessage } from '@earendil-works/pi-mcp'
import type { McpHandler } from './handler'
import { body, type OAuthServer } from './oauth'

export type HttpAuth = { readonly kind: 'none' } | { readonly kind: 'bearer'; readonly token: string } | { readonly kind: 'oauth'; readonly server: OAuthServer }

export interface ListenOptions {
  readonly auth: HttpAuth
  /** Default 127.0.0.1. */
  readonly host?: string
  /** Default 0, a free port. */
  readonly port?: number
  /**
   * The origin the server names in its URLs and OAuth metadata, when clients
   * reach it under another address (the T3 fake's LAN address). Default: the
   * address it listens on.
   */
  readonly publicOrigin?: (port: number) => string
}

export interface HttpListener {
  readonly origin: string
  /** `<origin>/mcp`. */
  readonly url: string
  readonly port: number
  /** Requests refused with 401. */
  readonly rejected: () => number
  readonly close: () => Promise<void>
}

export async function listen(handler: McpHandler, options: ListenOptions): Promise<HttpListener> {
  let rejected = 0
  let origin = ''
  const server = createServer((req, res) => {
    void serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    const { auth } = options
    if (auth.kind === 'oauth' && (await auth.server.route(req, res, origin))) return
    if (new URL(req.url ?? '/', origin).pathname !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    if (auth.kind === 'bearer' && req.headers.authorization !== `Bearer ${auth.token}`) {
      rejected++
      res.writeHead(401).end()
      return
    }
    if (auth.kind === 'oauth') {
      const verdict = auth.server.verify(req.headers.authorization)
      if (verdict !== 'ok') {
        rejected++
        auth.server.challenge(res, origin, verdict === 'invalid')
        return
      }
    }
    if (req.method === 'GET') return stream(req, res)
    if (req.method === 'DELETE') {
      res.writeHead(200).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const message = JSON.parse(await body(req)) as JsonRpcMessage
    const answer = await handler.answer(message)
    const session = 'method' in message && message.method === 'initialize' ? { 'mcp-session-id': randomUUID() } : {}
    if (answer.kind === 'drop') {
      // The call ran, then the connection closed before any answer.
      req.socket.destroy()
      return
    }
    if (answer.kind === 'none') {
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', ...session }).end(JSON.stringify(answer.message))
  }
  const stream = (req: IncomingMessage, res: ServerResponse) => {
    if (!String(req.headers.accept).includes('text/event-stream')) {
      res.writeHead(405).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(': open\n\n')
    const unsubscribe = handler.subscribe((message) => res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`))
    res.on('close', unsubscribe)
  }

  const host = options.host ?? '127.0.0.1'
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => resolve())
  })
  const { port } = server.address() as { port: number }
  origin = options.publicOrigin?.(port) ?? `http://${host.includes(':') ? `[${host}]` : host}:${port}`
  return {
    origin,
    url: `${origin}/mcp`,
    port,
    rejected: () => rejected,
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
