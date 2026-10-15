/**
 * A fake OpenAI-compatible endpoint over HTTP, as Ollama, LM Studio or vLLM
 * serve one: `GET /v1/models` with ids only (no prices, no window), and
 * `POST /v1/chat/completions` streaming one scripted answer. It records
 * which model each request named and which key it carried.
 */
import { createServer, type IncomingMessage } from 'node:http'

export interface OpenAiRequest {
  readonly model: string
  /** The bearer token the request carried. */
  readonly key: string | undefined
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

export interface FakeOpenAiOptions {
  /** What `GET /v1/models` lists; `null` answers 404, as a server that lists nothing. */
  readonly models?: ReadonlyArray<string> | null
  /** When set, a request with another bearer token is refused with 401. */
  readonly key?: string
  readonly answer?: string
}

export interface FakeOpenAi {
  /** The base URL to set up in Settings › Juno: `<origin>/v1`. */
  readonly baseUrl: string
  readonly requests: ReadonlyArray<OpenAiRequest>
  readonly close: () => Promise<void>
}

export async function startFakeOpenAi(options: FakeOpenAiOptions = {}): Promise<FakeOpenAi> {
  const requests: OpenAiRequest[] = []
  const models = options.models === undefined ? ['qwen3:8b', 'llama3.3:70b'] : options.models
  const answer = options.answer ?? '<say>Hello from the local model.</say>'
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname
      const key = req.headers.authorization?.replace(/^Bearer\s+/i, '')
      if (options.key !== undefined && key !== options.key) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }))
        return
      }
      if (req.method === 'GET' && path === '/v1/models' && models !== null) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model', owned_by: 'library' })) }))
        return
      }
      if (req.method !== 'POST' || path !== '/v1/chat/completions') {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(await read(req)) as { model?: string }
      const model = body.model ?? ''
      requests.push({ model, key })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (delta: unknown, finish: string | null, usage?: unknown) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage === undefined ? {} : { usage }) })}\n\n`
      res.write(chunk({ role: 'assistant', content: answer }, null))
      res.write(chunk({}, 'stop', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }))
      res.end('data: [DONE]\n\n')
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fake endpoint has no port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
