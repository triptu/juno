// S7: the token upper bound (UTF-8 bytes + 64 per message) against the usage each provider reports,
// and S2: cache marks inside a user message via pi-ai on OpenRouter. Small paid calls (a few cents).
// Run: node docs/juno-agent/spikes/s7-tokens.ts <path to .env with OPENROUTER_API_KEY>
import { readFileSync } from 'node:fs'
import { createModels, type Message } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'

const envFile = process.argv[2]
if (!envFile) throw new Error('usage: s7-tokens.ts <.env path>')
const apiKey = readFileSync(envFile, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
if (!apiKey) throw new Error('OPENROUTER_API_KEY not found')

const models = createModels()
models.setProvider(openrouterProvider())
const slugs = [
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
  'meta/muse-wonder',
  'openai/gpt-6.1-sol',
  'x-ai/grok-4.7',
  'anthropic/claude-haiku-5.5',
]

// Mixed content: prose, code, numbers, a URL, CJK, emoji and base64, the kinds a chat carries.
const sample = [
  'The quarterly sync moved to Thursday 14:30 UTC; Priya owns the agenda and Marco the notes.',
  'const total = items.reduce((sum, { price, qty }) => sum + price * qty, 0) // 3 decimal places',
  'https://example.com/a/b?c=1&d=2 #release-notes 42 3.14159 2026-10-14T09:00:00Z',
  '会议改到周四下午两点半。请提前准备材料。ありがとうございます。회의 자료를 확인해 주세요.',
  '🚀✅🔥 ¡Olá! naïve café façade — “quotes” and ‘single’ … ellipsis',
  'aGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQgZW5jb2RlZCB0ZXh0IGZvciB0b2tlbiBkZW5zaXR5Cg==',
].join('\n')
const system = 'You are Juno. Answer with one word.'
const user = Array.from({ length: 12 }, (_, i) => `${i}. ${sample}`).join('\n\n')
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
const bound = bytes(system) + bytes(user) + 64 * 2

let spend = 0
console.log(`prompt: ${bytes(system) + bytes(user)} bytes, bound ${bound} tokens`)
for (const slug of slugs) {
  const model = models.getModel('openrouter', slug)
  if (!model) {
    console.log(`${slug}: not in pi-ai catalogue`)
    continue
  }
  try {
    const reply = await models.complete(model, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { apiKey, maxTokens: 64, maxRetries: 0 })
    const u = reply.usage
    const input = u.input + u.cacheRead + u.cacheWrite
    spend += u.cost.total
    console.log(
      `${slug}: reported input ${input} tokens (${(input / bound).toFixed(2)} of bound; ${(bytes(user) / input).toFixed(2)} bytes per token), ` +
        `stop ${reply.stopReason}${reply.errorMessage ? ` error ${reply.errorMessage.slice(0, 120)}` : ''}, cost $${u.cost.total.toFixed(4)}`,
    )
  } catch (error) {
    console.log(`${slug}: failed: ${(error as Error).message.slice(0, 160)}`)
  }
}

// S2: a memory view inside the first user message, then a second turn. The second request should read the view from cache.
const sonnet = models.getModel('openrouter', 'anthropic/claude-sonnet-5.5')!
const view = Array.from({ length: 40 }, (_, i) => `[day ${i + 1}] ${sample.split('\n')[i % 3]}`).join('\n')
const first: Message = { role: 'user', content: `<memory>\n${view}\n</memory>\n\nWhat day is the sync? One word.`, timestamp: Date.now() }
const sessionId = `juno-spike-${Date.now()}`
const r1 = await models.complete(sonnet, { systemPrompt: system, messages: [first] }, { apiKey, maxTokens: 32, maxRetries: 0, sessionId })
const r2 = await models.complete(
  sonnet,
  { systemPrompt: system, messages: [first, r1, { role: 'user', content: 'And who owns the notes? One word.', timestamp: Date.now() }] },
  { apiKey, maxTokens: 32, maxRetries: 0, sessionId },
)
spend += r1.usage.cost.total + r2.usage.cost.total
console.log(
  `S2 cache: first request input ${r1.usage.input}, cacheWrite ${r1.usage.cacheWrite}, cacheRead ${r1.usage.cacheRead}; ` +
    `second request input ${r2.usage.input}, cacheWrite ${r2.usage.cacheWrite}, cacheRead ${r2.usage.cacheRead}`,
)
console.log(`total spend $${spend.toFixed(4)}`)
