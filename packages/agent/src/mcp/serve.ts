import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { Schema } from 'effect'
import { jsonObject } from './catalogue'

const Request = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'), id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.String, params: Schema.optionalKey(jsonObject),
})
export interface ServedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** Must use Juno's policy/dispatcher. This endpoint grants no additional authority. */
  readonly call: (args: unknown) => Promise<{ readonly text: string; readonly isError?: boolean }>
}

/** One Codex turn, one random credential, no cookies or public listener. */
export async function serveMcp(tools: ReadonlyArray<ServedTool>) {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const server = createServer((req, res) => {
    void (async () => {
      const supplied = Buffer.from(req.headers.authorization ?? '')
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end(); return }
      if (req.url !== '/mcp') { res.writeHead(404).end(); return }
      if (req.method === 'DELETE') { res.writeHead(200).end(); return }
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 1_000_000) { res.writeHead(413).end(); return }
        chunks.push(buffer)
      }
      const message = Schema.decodeUnknownSync(Request)(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (message.id === undefined) { res.writeHead(202).end(); return }
      const reply = (value: { readonly result: unknown } | { readonly error: { readonly code: number; readonly message: string } }) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...value }))
      switch (message.method) {
        case 'initialize':
          reply({ result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Juno', version: '1.0.0' } } }); return
        case 'ping': reply({ result: {} }); return
        case 'tools/list': reply({ result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } }); return
        case 'tools/call': {
          const tool = tools.find((tool) => tool.name === message.params?.name)
          if (!tool) { reply({ error: { code: -32602, message: 'Unknown tool' } }); return }
          try {
            const output = await tool.call(message.params?.arguments ?? {})
            reply({ result: { content: [{ type: 'text', text: output.text }], isError: output.isError ?? false } })
          } catch { reply({ result: { content: [{ type: 'text', text: 'The tool could not complete.' }], isError: true } }) }
          return
        }
        default: reply({ error: { code: -32601, message: 'Unknown method' } })
      }
    })().catch(() => { if (!res.headersSent) res.writeHead(400).end() })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No loopback address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, token,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
