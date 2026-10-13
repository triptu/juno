// A thin OpenRouter client. Reads the key from the main checkout's .env at
// call time and never logs it. Returns text, latency and the cost OpenRouter
// reports for the call.
import { readFileSync } from 'node:fs'

const ENV_PATH = '/Users/tushar/.t3/projects/juno/.env'

function apiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const env = readFileSync(ENV_PATH, 'utf8')
  const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(env)
  if (!m) throw new Error('OPENROUTER_API_KEY not found in .env')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

// Models that cannot turn reasoning off get the lowest effort instead.
export function reasoningFor(model) {
  return /claude-haiku/.test(model) ? { enabled: false } : { effort: 'low' }
}

export async function complete({ model, system, messages, maxTokens = 1200, temperature = 0.4, timeoutMs = 60000, reasoning = reasoningFor(model) }) {
  const started = performance.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://juno.local/topic-art-study',
        'X-Title': 'Juno topic art study',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
        temperature,
        usage: { include: true },
        reasoning,
      }),
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, latencyMs, costUsd: 0 }
    }
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content ?? ''
    const usage = json.usage ?? {}
    return {
      ok: true,
      text,
      latencyMs,
      costUsd: usage.cost ?? 0,
      tokens: { in: usage.prompt_tokens ?? 0, out: usage.completion_tokens ?? 0 },
    }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e), latencyMs: Math.round(performance.now() - started), costUsd: 0 }
  } finally {
    clearTimeout(timer)
  }
}
