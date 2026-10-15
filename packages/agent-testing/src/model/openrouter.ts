/**
 * A fake OpenRouter over HTTP, for tests that run the agent the way the app
 * does: OpenRouter's public model list, and the two chat APIs pi-ai speaks
 * to it (Anthropic Messages for Claude, OpenAI chat completions for the
 * rest), each streaming one scripted answer. It records which model each
 * request named and which key it carried, so a test can check that the key
 * set in Settings reached the provider and that the picked model is used.
 *
 * The catalogue is `fakeCatalogue` in OpenRouter's shape, so the picker
 * resolves the same slugs as the in-process fake provider.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fakeCatalogue } from './provider'

export interface OpenRouterRequest {
  readonly path: string
  readonly model: string
  /** The key the request carried (`x-api-key` or a bearer token). */
  readonly key: string | undefined
}

export interface FakeOpenRouterOptions {
  /** When set, a request with any other key is refused with 401, as OpenRouter does. */
  readonly key?: string
  /** What every chat request answers. Default: one bubble. */
  readonly answer?: string
}

export interface FakeOpenRouter {
  /** The origin to give the agent in place of `https://openrouter.ai`. */
  readonly origin: string
  readonly requests: ReadonlyArray<OpenRouterRequest>
  readonly catalogueReads: () => number
  readonly close: () => Promise<void>
}

const names: Readonly<Record<string, string>> = {
  'anthropic/claude-sonnet-5.5': 'Anthropic: Claude Sonnet 5.5',
  'anthropic/claude-opus-5.5': 'Anthropic: Claude Opus 5.5',
  'meta/muse-wonder': 'Meta: Muse Wonder',
  'openai/gpt-6.1-sol': 'OpenAI: GPT-6.1 Sol',
  'x-ai/grok-4.7': 'xAI: Grok 4.7',
  'anthropic/claude-haiku-5.5': 'Anthropic: Claude Haiku 5.5',
  'google/gemini-3.8-flash': 'Google: Gemini 3.8 Flash',
}

/** OpenRouter's `GET /api/v1/models` body: prices in dollars per token, as text. */
export function openRouterCatalogue() {
  return {
    data: fakeCatalogue.map((model, index) => ({
      id: model.id,
      name: names[model.id] ?? model.id,
      created: 1_790_000_000 + index,
      context_length: model.contextWindow,
      supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: model.maxTokens },
      pricing: { prompt: String((model.cost?.input ?? 0) / 1e6), completion: String((model.cost?.output ?? 0) / 1e6) },
    })),
  }
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

const event = (res: ServerResponse, name: string | undefined, data: unknown) =>
  res.write(`${name === undefined ? '' : `event: ${name}\n`}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)

function anthropic(res: ServerResponse, model: string, text: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  event(res, 'message_start', {
    type: 'message_start',
    message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
  })
  event(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  event(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  event(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })
  event(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function completions(res: ServerResponse, model: string, text: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta: unknown, finish: string | null, usage?: unknown) => ({
    id: 'gen-fake', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta, finish_reason: finish }], ...(usage === undefined ? {} : { usage }),
  })
  event(res, undefined, chunk({ role: 'assistant', content: text }, null))
  event(res, undefined, chunk({}, 'stop', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }))
  event(res, undefined, '[DONE]')
  res.end()
}

export async function startFakeOpenRouter(options: FakeOpenRouterOptions = {}): Promise<FakeOpenRouter> {
  const requests: OpenRouterRequest[] = []
  let catalogueReads = 0
  const answer = options.answer ?? '<say>Hello from the fake.</say>'
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname
      if (req.method === 'GET' && path === '/api/v1/models') {
        catalogueReads++
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(openRouterCatalogue()))
        return
      }
      if (req.method !== 'POST' || (path !== '/api/v1/messages' && path !== '/api/v1/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(await read(req)) as { model?: string }
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '')
      const key = (req.headers['x-api-key'] as string | undefined) ?? bearer
      const model = body.model ?? ''
      requests.push({ path, model, key })
      if (options.key !== undefined && key !== options.key) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'User not found.', code: 401 } }))
        return
      }
      if (path === '/api/v1/messages') anthropic(res, model, answer)
      else completions(res, model, answer)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fake OpenRouter has no port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    catalogueReads: () => catalogueReads,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
