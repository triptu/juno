// Collects generated/**.json into results.js (for sheet.html) and stats.md (the
// measured table for the README).
//
//   node build-sheet.mjs --top B/anthropic_claude-sonnet-5.5,C/anthropic_claude-haiku-5.5
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { topics } from './topics.mjs'
import { render } from './vocab.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean))
const top = (args.top ?? '').split(',').filter(Boolean)

const LABELS = { A: 'A · Free SVG', B: 'B · Constrained vocabulary', C: 'C · Motif kit', D: 'D · Vocabulary + kit' }
const MODEL_LABELS = { 'anthropic_claude-sonnet-5.5': 'Claude Sonnet 5.5', 'anthropic_claude-haiku-5.5': 'Claude Haiku 5.5', 'google_gemini-3.8-flash': 'Gemini 3.8 Flash' }

const runs = []
for (const approach of ['A', 'B', 'C', 'D']) {
  if (!existsSync(`generated/${approach}`)) continue
  for (const slug of readdirSync(`generated/${approach}`).sort()) {
    const items = topics.map((t) => {
      const f = `generated/${approach}/${slug}/${t.id}.json`
      if (!existsSync(f)) return { topic: t.id, title: t.title, ok: false, failure: 'not run' }
      const r = JSON.parse(readFileSync(f, 'utf8'))
      const item = { topic: t.id, title: t.title, ok: r.ok, failure: r.failure, attempts: r.attempts, latencyMs: r.latencyMs, costUsd: r.costUsd, decision: r.decision, canonical: r.canonical, channel: t.channel, fallback: r.ok && r.decision && r.decision.confident === false }
      if (r.ok && r.spec) {
        item.svg = { light: render(r.spec, { theme: 'light', size: 40, id: `l${approach}${slug}${t.id}` }), dark: render(r.spec, { theme: 'dark', size: 40, id: `d${approach}${slug}${t.id}` }) }
        item.small = { light: render(r.spec, { theme: 'light', size: 16, id: `sl${approach}${slug}${t.id}` }), dark: render(r.spec, { theme: 'dark', size: 16, id: `sd${approach}${slug}${t.id}` }) }
      } else if (r.ok && r.free) {
        item.svg = { light: r.free.svg, dark: r.free.svg }
        item.small = { light: r.free.svg.replace('width="40" height="40"', 'width="16" height="16"'), dark: r.free.svg.replace('width="40" height="40"', 'width="16" height="16"') }
        item.free = { elements: r.free.elements, gradients: r.free.gradients }
      }
      return item
    })
    const ran = items.filter((i) => i.failure !== 'not run')
    const ok = ran.filter((i) => i.ok)
    const lat = ran.map((i) => i.latencyMs).sort((a, b) => a - b)
    const cost = ran.reduce((s, i) => s + i.costUsd, 0)
    const stats = {
      n: ran.length, ok: ok.length, failRate: ran.length ? (ran.length - ok.length) / ran.length : 0,
      retries: ran.filter((i) => i.attempts > 1).length,
      fallbacks: ok.filter((i) => i.fallback).length,
      secondaries: ok.filter((i) => i.decision && i.decision.secondary).length,
      medianMs: lat[Math.floor(lat.length / 2)] ?? 0, p90Ms: lat[Math.floor(lat.length * 0.9)] ?? 0,
      meanCost: ran.length ? cost / ran.length : 0, cost300: ran.length ? (cost / ran.length) * 300 : 0, total: cost,
    }
    runs.push({ key: `${approach}-${slug}`, approach, slug, label: LABELS[approach], model: MODEL_LABELS[slug] ?? slug, stats, items })
  }
}

writeFileSync('results.js', `window.RESULTS = ${JSON.stringify({ runs, top, topics }, null, 0)};\n`)

const row = (r) => `| ${r.label} | ${r.model} | ${r.stats.ok}/${r.stats.n} | ${(r.stats.failRate * 100).toFixed(0)}% | ${r.stats.retries} | ${(r.stats.medianMs / 1000).toFixed(1)} s | ${(r.stats.p90Ms / 1000).toFixed(1)} s | $${r.stats.meanCost.toFixed(4)} | $${r.stats.cost300.toFixed(2)} |`
const md = ['| Approach | Model | OK | Failure rate | Retried | Median latency | p90 latency | Cost per icon | Cost per 300 topics |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...runs.map(row)].join('\n')
writeFileSync('stats.md', md + '\n')
const spend = runs.reduce((s, r) => s + r.stats.total, 0)
console.log(md)
console.log(`\nRecorded spend across all runs: $${spend.toFixed(4)}`)
