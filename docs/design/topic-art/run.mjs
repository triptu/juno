// Runs approaches x models x topics and records one result per icon in
// generated/<approach>/<model>/<topic>.json, plus the rendered SVGs.
//
//   node run.mjs --approach B --model anthropic/claude-haiku-5.5 [--topics pg16,rina] [--force]
//
// A result: { approach, model, topic, ok, attempts, latencyMs, costUsd,
//             tokens, failure?, raw, spec? (B/C/D), svg: { light, dark } }
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { topics } from './topics.mjs'
import { complete } from './openrouter.mjs'
import { parse, render, serialise, VocabError } from './vocab.mjs'
import { motifs } from './motifs.mjs'
import { HUE_NAMES } from './palette.mjs'
import { sanitiseFree } from './free-svg.mjs'
import { freePrompt, vocabPrompt, kitPrompt, hybridPrompt } from './prompts.mjs'
import { compose } from './run-compose.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean))
const approach = args.approach
const model = args.model
const only = typeof args.topics === 'string' ? args.topics.split(',') : null
const force = args.force === true
const concurrency = Number(args.concurrency ?? 4)
if (!approach || !model) { console.error('need --approach and --model'); process.exit(1) }

const slug = model.replace(/[^a-z0-9.-]+/gi, '_')
const dir = `generated/${approach}/${slug}`
mkdirSync(dir, { recursive: true })

const PROMPTS = { A: freePrompt, B: vocabPrompt, C: kitPrompt, D: hybridPrompt }
const prompt = PROMPTS[approach]

// Turn one model reply into a checked spec or throw VocabError.
function interpret(text) {
  if (approach === 'A') {
    const r = sanitiseFree(text)
    if (!r.ok) throw new VocabError(r.reason)
    return { free: r }
  }
  if (approach === 'B') return { spec: parse(text) }
  if (approach === 'D') return { spec: parse(text, { allowMotif: true }) }
  // C: JSON decision -> composed spec
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) throw new VocabError('no JSON object found')
  let j
  try { j = JSON.parse(m[0]) } catch { throw new VocabError('JSON does not parse') }
  if (!motifs[j.main]) throw new VocabError(`main motif ${JSON.stringify(j.main)} is not in the kit`)
  if (j.secondary != null && !motifs[j.secondary]) throw new VocabError(`secondary motif ${JSON.stringify(j.secondary)} is not in the kit`)
  if (j.secondary === j.main) j.secondary = null
  if (j.confident === undefined) j.confident = true
  if (!HUE_NAMES.includes(j.hue)) throw new VocabError(`hue ${JSON.stringify(j.hue)} is not in the palette`)
  return { spec: compose(j), decision: j }
}

async function one(t) {
  const file = `${dir}/${t.id}.json`
  if (!force && existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, 'utf8'))
    // A transport failure is not a model failure: run it again. A validation failure stays.
    if (prev.ok || !/^(TypeError|HTTP 5|timeout)/.test(prev.failure ?? '')) return prev
  }
  const messages = [{ role: 'user', content: prompt.user(t) }]
  let attempts = 0, latencyMs = 0, costUsd = 0, tokens = { in: 0, out: 0 }
  let result = { approach, model, topic: t.id, ok: false }
  let raw = ''
  while (attempts < 2) {
    attempts += 1
    const r = await complete({ model, system: prompt.system, messages, maxTokens: approach === 'A' ? 4000 : approach === 'C' ? 600 : 2500 })
    latencyMs += r.latencyMs; costUsd += r.costUsd
    if (r.tokens) { tokens.in += r.tokens.in; tokens.out += r.tokens.out }
    if (!r.ok) { result.failure = r.error; break }
    raw = r.text
    try {
      const out = interpret(r.text)
      result = { ...result, ok: true, ...out }
      break
    } catch (e) {
      if (!(e instanceof VocabError)) throw e
      result.failure = e.message
      if (!prompt.retry) break
      messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: prompt.retry(e.message) })
    }
  }
  result = { ...result, attempts, latencyMs, costUsd, tokens, raw }
  if (result.ok) {
    if (result.spec) {
      result.svg = { light: render(result.spec, { theme: 'light', id: `l-${approach}-${slug}-${t.id}` }), dark: render(result.spec, { theme: 'dark', id: `d-${approach}-${slug}-${t.id}` }) }
      result.canonical = serialise(result.spec)
      writeFileSync(`${dir}/${t.id}.svg`, result.svg.light)
    } else if (result.free) {
      result.svg = { light: result.free.svg, dark: result.free.svg }
      writeFileSync(`${dir}/${t.id}.svg`, result.free.svg)
    }
  }
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
    console.log(`${approach} ${slug} ${t.id.padEnd(12)} ${r.ok ? 'ok ' : 'FAIL'} ${String(r.latencyMs).padStart(6)}ms $${r.costUsd.toFixed(4)} x${r.attempts}${r.failure ? '  ' + r.failure : ''}`)
  }
}))
const ok = results.filter((r) => r.ok).length
const cost = results.reduce((s, r) => s + r.costUsd, 0)
const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b)
console.log(`\n${approach} ${model}: ${ok}/${results.length} ok, cost $${cost.toFixed(4)}, median ${lat[Math.floor(lat.length / 2)]}ms, p90 ${lat[Math.floor(lat.length * 0.9)]}ms`)
