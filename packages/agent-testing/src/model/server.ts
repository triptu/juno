/**
 * A fake OpenRouter on loopback HTTP, for the desktop app's e2e tests: the
 * agent process cannot load the in-process scripted model, so it reaches
 * this server through `openRouterTurns(key, { baseUrl })` instead. pi-ai
 * sends Juno's default models (Claude) to OpenRouter's Anthropic Messages
 * endpoint, so this speaks that stream. It answers each chat request with
 * `answer`, each compaction request with the deterministic compactor, and
 * records what it was sent.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { COMPACTION_MODELS, compactorText } from './compactor'

/** One request as the model got it: every message's text, in order. */
export interface FakeOpenRouterRequest {
  readonly model: string
  /** A compaction model's request, answered by the compactor, not `answer`. */
  readonly compaction: boolean
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>
  /** The last user message's text: the input the request answers. */
  readonly input: string
}

export interface FakeOpenRouterOptions {
  /** The model's whole text for a request. Default: a bubble that echoes the input's last line. */
  readonly answer?: (request: FakeOpenRouterRequest) => string | Promise<string>
}

export interface FakeOpenRouter {
  /** The base URL the models take in place of `https://openrouter.ai/api`. */
  readonly url: string
  readonly requests: ReadonlyArray<FakeOpenRouterRequest>
  /** The last user message of each chat request, in order. */
  readonly inputs: () => ReadonlyArray<string>
  readonly close: () => Promise<void>
}

type WireMessage = { readonly role: string; readonly content: unknown }

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : '')).join('') : ''

const echo = (request: FakeOpenRouterRequest) => `<say>${request.input.replace(/<[^>]*>/g, '').trim().split('\n').at(-1) ?? ''}</say>`

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

export async function startFakeOpenRouter(options: FakeOpenRouterOptions = {}): Promise<FakeOpenRouter> {
  const requests: FakeOpenRouterRequest[] = []
  const answer = options.answer ?? echo

  const messages = async (raw: string, response: ServerResponse) => {
    const parsed = JSON.parse(raw) as { model: string; messages: ReadonlyArray<WireMessage> }
    const seen = parsed.messages.map((message) => ({ role: message.role, text: textOf(message.content) }))
    const compaction = COMPACTION_MODELS.includes(parsed.model)
    const request: FakeOpenRouterRequest = { model: parsed.model, compaction, messages: seen, input: seen.findLast((message) => message.role === 'user')?.text ?? '' }
    requests.push(request)
    const text = compaction
      ? compactorText(seen.filter((message) => message.role === 'user').map((message) => message.text), requests.filter((r) => r.compaction).length - 1)
      : await answer(request)
    const input = Math.ceil(raw.length / 4)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.write(
      event('message_start', {
        message: { id: `fake-${requests.length}`, type: 'message', role: 'assistant', model: parsed.model, content: [], stop_reason: null, usage: { input_tokens: input, output_tokens: 0 } },
      }),
    )
    response.write(event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }))
    response.write(event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }))
    response.write(event('content_block_stop', { index: 0 }))
    response.write(event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { input_tokens: input, output_tokens: Math.ceil(text.length / 4) } }))
    response.end(event('message_stop', {}))
  }

  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url?.split('?')[0]?.endsWith('/v1/messages')) {
      body(request)
        .then((raw) => messages(raw, response))
        .catch((cause: unknown) => {
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(cause) } }))
        })
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `${request.method} ${request.url}` } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/api`,
    requests,
    inputs: () => requests.filter((request) => !request.compaction).map((request) => request.input),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
