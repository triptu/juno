/**
 * A fake OpenRouter over HTTP, for tests that run the agent the way the app
 * does: OpenRouter's public model list, and the two chat APIs pi-ai speaks
 * to it (Anthropic Messages for Claude, OpenAI chat completions for the
 * rest), each streaming one answer. It records which model each request
 * named, which key it carried and the last user message, so a test can check
 * that the key set in Settings reached the provider, that the picked model is
 * used, and what the agent sent. Compaction models are answered by the
 * deterministic compactor, as in the in-process fake. An answer can be one
 * tool call; the request after it carries the tool's result.
 *
 * The catalogue is `fakeCatalogue` in OpenRouter's shape, so the picker
 * resolves the same slugs as the in-process fake provider.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { COMPACTION_MODELS, fakeCatalogue } from './catalogue'
import { compactorText } from './compactor'
import { choice, fakeReview, type FakeReviewAnswers, type FakeReviewRequest } from './review'

export interface OpenRouterRequest {
  readonly path: string
  readonly model: string
  /** The key the request carried (`x-api-key` or a bearer token). */
  readonly key: string | undefined
  /** A compaction model's request, answered by the compactor. */
  readonly compaction: boolean
  /** The last user message's text: the input the request answers. */
  readonly input: string
  /** When the request follows a tool call: the tool's result text. */
  readonly toolResult?: string
  /** The image parts the request's user messages carried, by type and size in bytes. */
  readonly images: ReadonlyArray<{ readonly mimeType: string; readonly bytes: number }>
}

/** One tool call instead of text; the next request carries its result in `toolResult`. */
export interface ToolCallAnswer {
  readonly toolCall: { readonly name: string; readonly arguments: Record<string, unknown> }
}

export interface FakeOpenRouterOptions {
  /** When set, a request with any other key is refused with 401, as OpenRouter does. */
  readonly key?: string
  /** What a chat request answers: fixed text, or text from the request, now or later. Default: one bubble. */
  readonly answer?: string | ((request: OpenRouterRequest) => string | ToolCallAnswer | Promise<string | ToolCallAnswer>)
  /** How the decision model (System One, `/api/v1/systemone`) answers an auto-review. Default: `fakeReview`. */
  readonly review?: (request: FakeReviewRequest) => FakeReviewAnswers
}

export interface FakeOpenRouter {
  /** The origin to give the agent in place of `https://openrouter.ai`. */
  readonly origin: string
  readonly requests: ReadonlyArray<OpenRouterRequest>
  /** The chat requests' inputs, in order. */
  readonly inputs: () => ReadonlyArray<string>
  readonly catalogueReads: () => number
  /** The auto-reviews the decision model was asked for, in order. */
  readonly reviews: ReadonlyArray<FakeReviewRequest>
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
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
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

type WireMessage = { readonly role: string; readonly content: unknown }

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : '')).join('') : ''

const event = (res: ServerResponse, name: string | undefined, data: unknown) =>
  res.write(`${name === undefined ? '' : `event: ${name}\n`}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)

/** Image parts in user messages: Anthropic `image` blocks with a base64 source, or chat completions `image_url` data URLs. */
function imagesOf(messages: ReadonlyArray<WireMessage>): OpenRouterRequest['images'] {
  return messages
    .filter((message) => message.role === 'user' && Array.isArray(message.content))
    .flatMap((message) => message.content as ReadonlyArray<{ type?: unknown; source?: { media_type?: unknown; data?: unknown }; image_url?: { url?: unknown } }>)
    .flatMap((part) => {
      if (part.type === 'image' && typeof part.source?.data === 'string') return [{ mimeType: String(part.source.media_type), bytes: Buffer.from(part.source.data, 'base64').byteLength }]
      const url = part.type === 'image_url' && typeof part.image_url?.url === 'string' ? /^data:([^;]+);base64,(.*)$/.exec(part.image_url.url) : null
      return url === null ? [] : [{ mimeType: url[1]!, bytes: Buffer.from(url[2]!, 'base64').byteLength }]
    })
}

/** A tool call's id, unique within the fake's life. */
let toolCalls = 0

/** The tool results after the model's last turn: Anthropic `tool_result` blocks, or chat completions `tool` messages. */
function toolResultOf(messages: ReadonlyArray<WireMessage>): string | undefined {
  const after = messages.slice(messages.findLastIndex((message) => message.role === 'assistant') + 1)
  const results = after.flatMap((message) => {
    if (message.role === 'tool') return [textOf(message.content)]
    if (message.role !== 'user' || !Array.isArray(message.content)) return []
    return (message.content as ReadonlyArray<{ type?: unknown; content?: unknown }>).filter((part) => part.type === 'tool_result').map((part) => textOf(part.content))
  })
  return results.length === 0 ? undefined : results.join('\n')
}

function anthropic(res: ServerResponse, model: string, answer: string | ToolCallAnswer) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  event(res, 'message_start', {
    type: 'message_start',
    message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
  })
  if (typeof answer === 'string') {
    event(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } })
  } else {
    const { name, arguments: input } = answer.toolCall
    event(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_fake_${++toolCalls}`, name, input: {} } })
    event(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  }
  event(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  event(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: typeof answer === 'string' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } })
  event(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function completions(res: ServerResponse, model: string, answer: string | ToolCallAnswer) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta: unknown, finish: string | null, usage?: unknown) => ({
    id: 'gen-fake', object: 'chat.completion.chunk', created: 0, model,
    choices: [{ index: 0, delta, finish_reason: finish }], ...(usage === undefined ? {} : { usage }),
  })
  if (typeof answer === 'string') {
    event(res, undefined, chunk({ role: 'assistant', content: answer }, null))
  } else {
    const call = { index: 0, id: `call_fake_${++toolCalls}`, type: 'function', function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) } }
    event(res, undefined, chunk({ role: 'assistant', tool_calls: [call] }, null))
  }
  event(res, undefined, chunk({}, typeof answer === 'string' ? 'stop' : 'tool_calls', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }))
  event(res, undefined, '[DONE]')
  res.end()
}

export async function startFakeOpenRouter(options: FakeOpenRouterOptions = {}): Promise<FakeOpenRouter> {
  const requests: OpenRouterRequest[] = []
  const reviews: FakeReviewRequest[] = []
  let catalogueReads = 0
  const answer = options.answer ?? '<say>Hello from the fake.</say>'
  let compactions = 0
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname
      if (req.method === 'GET' && path === '/api/v1/models') {
        catalogueReads++
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(openRouterCatalogue()))
        return
      }
      if (req.method === 'POST' && path === '/api/v1/systemone') {
        const review = JSON.parse(await read(req)) as FakeReviewRequest
        reviews.push(review)
        const answers = (options.review ?? fakeReview)(review)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answers: {
          intent: { type: 'choice', ...choice(answers.intent, ['explicit', 'implied', 'notAsked']) },
          risk: { type: 'choice', ...choice(answers.risk, ['read', 'reversible', 'write', 'delete', 'send']) },
        } }))
        return
      }
      if (req.method !== 'POST' || (path !== '/api/v1/messages' && path !== '/api/v1/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(await read(req)) as { model?: string; messages?: ReadonlyArray<WireMessage> }
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '')
      const key = (req.headers['x-api-key'] as string | undefined) ?? bearer
      const model = body.model ?? ''
      const messages = body.messages ?? []
      const users = messages.filter((message) => message.role === 'user').map((message) => textOf(message.content)).filter((text) => text !== '')
      const result = toolResultOf(messages)
      const request: OpenRouterRequest = { path, model, key, compaction: COMPACTION_MODELS.includes(model), input: users.at(-1) ?? '', images: imagesOf(messages), ...(result === undefined ? {} : { toolResult: result }) }
      requests.push(request)
      if (options.key !== undefined && key !== options.key) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'User not found.', code: 401 } }))
        return
      }
      const text = request.compaction ? compactorText(users, compactions++) : typeof answer === 'string' ? answer : await answer(request)
      if (path === '/api/v1/messages') anthropic(res, model, text)
      else completions(res, model, text)
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
    inputs: () => requests.filter((request) => !request.compaction).map((request) => request.input),
    catalogueReads: () => catalogueReads,
    reviews,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
