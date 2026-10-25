// The fake OpenRouter behind a proxy the test steers. `hold` keeps the next chat request that
// matches until the test releases it, so a test can act while Juno is busy and wait on state
// instead of time. `catalogue` rewrites the model list the agent reads.
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { startFakeOpenRouter, type FakeOpenRouter, type FakeOpenRouterOptions, type OpenRouterRequest } from '@juno/agent-testing/openrouter'

/**
 * The model the e2e agent talks to. It answers each message by echoing its
 * words, reacts with 🎉 when asked to "react", answers "formatting" with
 * markdown and HTML bold, and says nothing to a reaction. `requests` is what the agent sent.
 */
export function answer(request: OpenRouterRequest): string {
  const input = request.input
  if (input.startsWith('<reaction')) return ''
  const id = /<message id="(n\d+)">/.exec(input)?.[1]
  const words = input.replace(/<about[^>]*\/>|<about[\s\S]*?<\/about>|<quote[\s\S]*?<\/quote>|<[^>]*>/g, '').trim()
  if (/\breact\b/.test(words) && id !== undefined) return `<react to="${id}">🎉</react><say>Reacted to ${words}</say>`
  if (/\bquote me\b/.test(words) && id !== undefined) return `<say reply-to="${id}">Answering ${words}</say>`
  if (/\blong one\b/.test(words)) return '<say>Here is the long one: the deploy moved to Thursday, Maya owns the migration, and Leo reviews it before the freeze.</say>'
  if (/\bformatting\b/.test(words)) return '<say>**Staging** is green, and <b>deploys</b> run at 14:00.</say>'
  return `<say>You said: ${words}</say>`
}

export interface CatalogueModel {
  readonly id: string
  readonly name: string
  readonly created: number
  readonly context_length: number
  readonly supported_parameters: ReadonlyArray<string>
  readonly [key: string]: unknown
}

export interface ScriptedModelOptions extends FakeOpenRouterOptions {
  /** Rewrites OpenRouter's model list before the agent reads it. */
  readonly catalogue?: (models: ReadonlyArray<CatalogueModel>) => ReadonlyArray<CatalogueModel>
}

/** A held chat request. */
export interface Gate {
  /** Whether the request reached the model and is held. */
  readonly arrived: () => boolean
  /** Lets it through. Releasing before it arrives lets it through on arrival. */
  readonly release: () => void
}

export interface ScriptedModel extends FakeOpenRouter {
  /** Holds the next chat request whose body contains `text` (in the last user message, a tool result or anywhere). */
  readonly hold: (text: string) => Gate
}

interface Hold {
  readonly text: string
  taken: boolean
  arrived: boolean
  released: boolean
  readonly waiters: Array<() => void>
}

const read = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export async function startScriptedModel(options: ScriptedModelOptions = {}): Promise<ScriptedModel> {
  const fake = await startFakeOpenRouter(options)
  const target = new URL(fake.origin)
  const holds: Hold[] = []
  const server = createServer((req, res) => {
    void (async () => {
      const body = await read(req)
      const path = new URL(req.url ?? '/', 'http://proxy').pathname
      if (req.method === 'POST') {
        const text = body.toString('utf8')
        const hold = holds.find((h) => !h.taken && text.includes(h.text))
        if (hold !== undefined) {
          hold.taken = true
          hold.arrived = true
          if (!hold.released) await new Promise<void>((resolve) => hold.waiters.push(resolve))
        }
      }
      const upstream = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
        if (req.method === 'GET' && path === '/api/v1/models' && options.catalogue !== undefined) {
          void read(answer).then((raw) => {
            const list = JSON.parse(raw.toString('utf8')) as { data: ReadonlyArray<CatalogueModel> }
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: options.catalogue!(list.data) }))
          })
          return
        }
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      })
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      upstream.end(body)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the model proxy has no port')
  return {
    ...fake,
    origin: `http://127.0.0.1:${address.port}`,
    hold: (text) => {
      const hold: Hold = { text, taken: false, arrived: false, released: false, waiters: [] }
      holds.push(hold)
      return {
        arrived: () => hold.arrived,
        release: () => {
          hold.released = true
          for (const resolve of hold.waiters.splice(0)) resolve()
        },
      }
    },
    close: async () => {
      for (const hold of holds) {
        hold.released = true
        for (const resolve of hold.waiters.splice(0)) resolve()
      }
      await new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
      await fake.close()
    },
  }
}
