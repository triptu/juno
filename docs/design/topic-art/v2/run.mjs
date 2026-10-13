// Runs one freedom level over the topic set on Gemini 3.8 Flash and records
// one result per icon in generated/<level>/<topic>.json.
//
//   node run.mjs --level strict|relaxed|art [--topics pg16,main-eng] [--force] [--pass 1]
//
// A result: { level, model, topic, ok, attempts, latencyMs, costUsd, tokens,
//             failure?, raw, spec?, canonical?, elements? }
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { topics } from './topics.mjs'
import { complete } from '../openrouter.mjs'
import { parse, serialise, countElements, VocabError, LEVELS } from './vocab.mjs'
import { PROMPTS } from './prompts.mjs'

export const MODEL = 'google/gemini-3.8-flash'
const MAX_TOKENS = { strict: 2500, relaxed: 3000, art: 4000 }

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean))
const level = args.level
const only = typeof args.topics === 'string' ? args.topics.split(',') : null
const force = args.force === true
const concurrency = Number(args.concurrency ?? 3)
if (!LEVELS[level]) { console.error('need --level strict|relaxed|art'); process.exit(1) }

const dir = `generated/${level}`
mkdirSync(dir, { recursive: true })
const prompt = PROMPTS[level]

async function one(t) {
  const file = `${dir}/${t.id}.json`
  if (!force && existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, 'utf8'))
    if (prev.ok || !/^(TypeError|HTTP 5|timeout)/.test(prev.failure ?? '')) return prev
  }
  const messages = [{ role: 'user', content: prompt.user(t) }]
  let attempts = 0, latencyMs = 0, costUsd = 0, tokens = { in: 0, out: 0 }
  let result = { level, model: MODEL, topic: t.id, ok: false }
  let raw = ''
  while (attempts < 2) {
    attempts += 1
    const r = await complete({ model: MODEL, system: prompt.system, messages, maxTokens: MAX_TOKENS[level] })
    latencyMs += r.latencyMs; costUsd += r.costUsd
    if (r.tokens) { tokens.in += r.tokens.in; tokens.out += r.tokens.out }
    if (!r.ok) { result.failure = r.error; break }
    raw = r.text
    try {
      const spec = parse(r.text, level)
      result = { ...result, ok: true, spec, canonical: serialise(spec), elements: countElements(spec) }
      delete result.failure
      break
    } catch (e) {
      if (!(e instanceof VocabError)) throw e
      result.failure = e.message
      messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: prompt.retry(e.message) })
    }
  }
  result = { ...result, attempts, latencyMs, costUsd, tokens, raw }
  writeFileSync(file, JSON.stringify(result, null, 2))
  return result
}

const list = only ? topics.filter((t) => only.includes(t.id)) : topics
const results = []
let i = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (i < list.length) {
    const t = list[i++]
    const r = await one(t)
    results.push(r)
    console.log(`${level.padEnd(7)} ${t.id.padEnd(16)} ${r.ok ? 'ok ' : 'FAIL'} ${String(r.latencyMs).padStart(6)}ms $${r.costUsd.toFixed(4)} x${r.attempts}${r.elements ? ' ' + r.elements + 'el' : ''}${r.failure ? '  ' + r.failure : ''}`)
  }
}))
const ok = results.filter((r) => r.ok).length
const cost = results.reduce((s, r) => s + r.costUsd, 0)
const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b)
console.log(`\n${level}: ${ok}/${results.length} ok, cost $${cost.toFixed(4)}, median ${lat[Math.floor(lat.length / 2)]}ms, p90 ${lat[Math.floor(lat.length * 0.9)]}ms`)
// Every call's cost is appended to spend.log so the total survives --force reruns.
appendFileSync('spend.log', `${new Date().toISOString()} ${level} pass=${args.pass ?? '?'} n=${results.length} cost=${cost.toFixed(4)}\n`)
