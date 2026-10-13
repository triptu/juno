// Collects generated/<level>/*.json into results.js (for sheet.html) and
// stats.md (the measured table for the README).
//
//   node build-sheet.mjs --top strict/none,relaxed/subtle
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { topics } from './topics.mjs'
import { render, LEVELS, LEVEL_NAMES, CONTAINERS } from './vocab.mjs'
import { tide } from './tide.mjs'
import { roles, HUE_NAMES, SURFACES, contrast, tideTones, HUES } from './palette.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean))
const top = (args.top ?? '').split(',').filter(Boolean)

const runs = []
for (const level of LEVEL_NAMES) {
  const items = topics.map((t) => {
    const f = `generated/${level}/${t.id}.json`
    const base = { topic: t.id, title: t.title, kind: t.kind ?? 'thread', channel: t.channel }
    if (!existsSync(f)) return { ...base, ok: false, failure: 'not run' }
    const r = JSON.parse(readFileSync(f, 'utf8'))
    const item = { ...base, ok: r.ok, failure: r.failure, attempts: r.attempts, latencyMs: r.latencyMs, costUsd: r.costUsd, canonical: r.canonical, elements: r.elements, hue: r.spec?.hue, confident: r.spec?.confident !== false, svg: {} }
    if (r.ok) {
      for (const container of Object.keys(CONTAINERS)) {
        for (const theme of ['light', 'dark']) {
          for (const size of [40, 16]) {
            item.svg[`${container}-${theme}-${size}`] = render(r.spec, { theme, size, container, id: `${level}${container}${theme[0]}${size}${t.id}` })
          }
        }
      }
    }
    return item
  })
  const ran = items.filter((i) => i.failure !== 'not run')
  if (ran.length === 0) continue
  const ok = ran.filter((i) => i.ok)
  const lat = ran.map((i) => i.latencyMs).sort((a, b) => a - b)
  const cost = ran.reduce((s, i) => s + i.costUsd, 0)
  const els = ok.map((i) => i.elements).sort((a, b) => a - b)
  const stats = {
    n: ran.length, ok: ok.length, failRate: ran.length ? (ran.length - ok.length) / ran.length : 0,
    retries: ran.filter((i) => i.attempts > 1).length,
    medianMs: lat[Math.floor(lat.length / 2)] ?? 0, p90Ms: lat[Math.floor(lat.length * 0.9)] ?? 0,
    meanCost: ran.length ? cost / ran.length : 0, cost300: ran.length ? (cost / ran.length) * 300 : 0, total: cost,
    medianElements: els[Math.floor(els.length / 2)] ?? 0,
    notConfident: ok.filter((i) => !i.confident).length,
    hues: Object.fromEntries(HUE_NAMES.map((h) => [h, ok.filter((i) => i.hue === h).length])),
  }
  runs.push({ level, label: LEVELS[level].label, stats, items })
}

// Placeholders for every topic, per container, theme and size.
const EXTRA_PLACEHOLDERS = [{ id: 'retro', title: 'Retro notes are in the doc', kind: 'thread' }]
const placeholders = [...topics, ...EXTRA_PLACEHOLDERS].map((t) => {
  const svg = {}
  for (const container of Object.keys(CONTAINERS)) for (const theme of ['light', 'dark']) for (const size of [40, 16]) {
    svg[`${container}-${theme}-${size}`] = tide(t.id, { theme, size, container, id: `ph${container}${theme[0]}${size}${t.id}` })
  }
  return { topic: t.id, title: t.title, kind: t.kind ?? 'thread', svg }
})

// Palette swatches and contrast for the palette section.
const palette = {}
for (const theme of ['light', 'dark']) {
  palette[theme] = HUE_NAMES.map((h) => {
    const c = roles(h, theme)
    const t = tideTones(HUES[h], theme)
    return { hue: h, ...c, tide: t, inkOnSidebar: contrast(c.ink, SURFACES[theme].sidebar).toFixed(1), inkOnSelected: contrast(c.ink, SURFACES[theme].selected).toFixed(1), accentOnSidebar: contrast(c.accent, SURFACES[theme].sidebar).toFixed(1), softOnSidebar: contrast(c.soft, SURFACES[theme].sidebar).toFixed(2) }
  })
}

writeFileSync('results.js', `window.RESULTS = ${JSON.stringify({ runs, top, topics, placeholders, palette, containers: CONTAINERS, surfaces: SURFACES }, null, 0)};\n`)

const row = (r) => `| ${r.label} | ${r.stats.ok}/${r.stats.n} | ${(r.stats.failRate * 100).toFixed(0)}% | ${r.stats.retries} | ${(r.stats.medianMs / 1000).toFixed(1)} s | ${(r.stats.p90Ms / 1000).toFixed(1)} s | ${r.stats.medianElements} | ${r.stats.notConfident} | $${r.stats.meanCost.toFixed(4)} | $${r.stats.cost300.toFixed(2)} |`
const md = ['| Level | OK | Failure rate | Retried | Median latency | p90 latency | Median elements | Not confident | Cost per icon | Cost per 300 topics |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...runs.map(row)].join('\n')
writeFileSync('stats.md', md + '\n')
console.log(md)
for (const r of runs) console.log(r.level, 'hues', JSON.stringify(r.stats.hues))
