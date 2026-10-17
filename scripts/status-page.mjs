// Builds the owner's local status page. Output: .juno-status/index.html (gitignored).
//
//   node scripts/status-page.mjs [--root <checkout>]
//
// A git post-commit and post-merge hook runs this, so it must stay fast and must
// never fail on a missing or broken file. The page reloads itself every 20 s and
// keeps its search and area filter across reloads.
//
// .juno-status/now.json is written by the orchestrator (local, not committed).
// Keep each list accurate, since the owner reads the page top to bottom:
//
//   needsYou   [{ title, detail }]  Real blockers only: work that is stopped until
//              the owner acts or answers. Remove an item as soon as it is resolved.
//              Optional checks and questions that can wait go in `later`.
//   running    [{ name, model?, detail?, since? }]  Agents working right now. Drop
//              an agent when it finishes.
//   next       ["..." or { name, detail }]  What starts after the running work, in order.
//   later      [{ title, detail }]  "When you have time": optional checks, live
//              tests and questions the owner can take up whenever. Not blockers.
//   pendingDecisions ["MM-DD HH:MM · who · text"]  Calls made for the owner that
//              they may want to override.
//   ideas      ["..." or { name, detail }]  Possible work nobody has picked up.
//   updated    ISO time of the last write.
//
// Also read: docs/decision-log.md, main's git history, .juno-status/ci-keeper.md
// (last green commit, DMG), .juno-status/health.json and apps/desktop/release.
// Areas of work are tagged by the keyword table in status-areas.mjs.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { areas } from './status-areas.mjs'
import { clientScript } from './status-client.mjs'
import { changesSince, readDecisions, readDmg, readJson, readKeeper, readLanded } from './status-data.mjs'

const rootArg = process.argv.indexOf('--root')
const root = rootArg > 0 ? resolve(process.argv[rootArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.juno-status')

const now = readJson(join(outDir, 'now.json')) ?? {}
const health = readJson(join(outDir, 'health.json'))
const decisions = readDecisions(root)
const landed = readLanded(root)
const keeper = readKeeper(root)
const dmg = readDmg(root)
const list = (value) => (Array.isArray(value) ? value : [])

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')
const ist = (date, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', ...options }).format(date)
const clock = (date) => ist(date, { hour: '2-digit', minute: '2-digit' })
const dayLabel = (mmdd) => {
  const [month, day] = mmdd.split('-').map(Number)
  const date = new Date(Date.UTC(new Date().getUTCFullYear(), month - 1, day, 12))
  return Number.isNaN(date.getTime()) ? mmdd : ist(date, { weekday: 'short', day: 'numeric', month: 'short' })
}
const tags = (names) => names.map((name) => `<span class="tag">${esc(name)}</span>`).join('')
const ago = (date) => `<span data-ts="${date.getTime()}"></span>`

const updatedTimes = [now.updated, now.updatedAt].map((t) => new Date(t)).filter((d) => !Number.isNaN(d.getTime()))
const updated = updatedTimes.toSorted((a, b) => b - a)[0]

const section = (id, title, body, count) =>
  `<section id="${id}"><h2>${esc(title)}${count ? ` <span class="count">${count}</span>` : ''}</h2>${body}</section>`

// Needs you, running, next.
const needs = list(now.needsYou)
const needsBody = needs.length
  ? `<ul class="cards">${needs.map((n) => `<li class="card needs"><strong>${inline(n.title)}</strong>${n.detail ? `<p>${inline(n.detail)}</p>` : ''}</li>`).join('')}</ul>`
  : ''

const running = list(now.running)
const runningBody = running.length
  ? `<ul class="cards">${running
      .map(
        (r) =>
          `<li class="card"><strong>${inline(r.name)}</strong>${r.model || r.since ? `<span class="meta"> · ${esc(r.model ?? '')}${r.since ? ` since ${esc(r.since)}` : ''}</span>` : ''}${r.detail ? `<p>${inline(r.detail)}</p>` : ''}</li>`,
      )
      .join('')}</ul>`
  : '<p class="quiet">No agents running.</p>'

// A list item is a plain string or { name, detail }.
const item = (n) =>
  typeof n === 'string' ? inline(n) : `<strong>${inline(n.name ?? n.title ?? '')}</strong>${n.detail ? ` · ${inline(n.detail)}` : ''}`
const nextItems = list(now.next)
const nextBody = nextItems.length
  ? `<ol class="plain">${nextItems.map((n) => `<li>${item(n)}</li>`).join('')}</ol>`
  : '<p class="quiet">Nothing queued.</p>'

// Build: last green commit, DMG, health.
const greenAt = changesSince(root, keeper.green?.hash)
const buildParts = [
  keeper.green
    ? `<div class="stat"><span class="label">Last green</span><code>${esc(keeper.green.hash.slice(0, 8))}</code> <span class="meta">${esc(keeper.green.date)}${greenAt > 0 ? ` · main has ${greenAt} change${greenAt === 1 ? '' : 's'} since` : greenAt === 0 ? ' · main is at it' : ''}</span></div>`
    : '<div class="stat"><span class="label">Last green</span><span class="meta">none recorded</span></div>',
  `<div class="stat"><span class="label">DMG</span>${keeper.dmgHash ? `from <code>${esc(keeper.dmgHash.slice(0, 8))}</code> ` : ''}<span class="meta">${dmg ? `local ${esc(dmg.name)} built ${esc(ist(dmg.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : 'no local DMG'}</span></div>`,
]
if (health) {
  const c = health.counts ?? {}
  buildParts.push(
    `<div class="stat"><span class="label">Health</span><span class="meta">${esc(c.oversizedFiles ?? '?')} files over 400 lines · ${esc(c.oversizedFunctions ?? '?')} long functions · ${esc(c.clonePairs ?? '?')} clones · ${esc((c.unusedFiles ?? 0) + (c.unusedExports ?? 0) + (c.unusedDependencies ?? 0))} unused</span></div>`,
  )
}
const buildBody = `<div class="stats">${buildParts.join('')}</div>`

// Recently landed on main, with the decisions each branch recorded.
const byWho = Map.groupBy(decisions, (d) => d.who)
const landedRow = (l) => {
  const linked = byWho.get(l.branch) ?? []
  const title = l.branch || l.subject
  const more = [
    ...l.merged.map((s) => `<li>${inline(s)}</li>`),
    ...linked.map((d) => `<li class="linked">Decision: ${inline(d.text)}</li>`),
  ]
  const head = `<span class="time">${esc(l.when)}</span><span class="title">${inline(title)}</span><span class="tags">${tags(l.areas)}</span><span class="meta">${l.merged.length ? `${l.merged.length} commit${l.merged.length === 1 ? '' : 's'}` : esc(l.hash)}${linked.length ? ` · ${linked.length} decision${linked.length === 1 ? '' : 's'}` : ''}</span>`
  return `<li class="filterable landed" data-areas="${esc(l.areas.join('|'))}">${more.length ? `<details><summary>${head}</summary><ul class="sub">${more.join('')}</ul></details>` : `<div class="summary">${head}</div>`}</li>`
}
const landedBody = landed.length
  ? `<ul class="rows">${landed.slice(0, 10).map(landedRow).join('')}</ul>${landed.length > 10 ? `<details class="more"><summary>${landed.length - 10} earlier</summary><ul class="rows">${landed.slice(10).map(landedRow).join('')}</ul></details>` : ''}`
  : '<p class="quiet">No history found.</p>'

// When you have time: later, decisions made for the owner, ideas.
const fold = (title, detail) =>
  `<li><details><summary>${inline(title)}</summary>${detail ? `<p>${inline(detail)}</p>` : ''}</details></li>`
const later = list(now.later)
// "MM-DD HH:MM · who · text", or any other string.
const pendingRow = (p) => {
  const [when, who, ...rest] = typeof p === 'string' ? p.split(' · ') : []
  return rest.length
    ? `<li class="decision"><span class="time">${esc(when)}</span><span class="who">${esc(who)}</span><span class="text">${inline(rest.join(' · '))}</span></li>`
    : `<li class="decision"><span></span><span></span><span class="text">${item(p)}</span></li>`
}
const pending = list(now.pendingDecisions)
const ideas = list(now.ideas)
const laterBody = [
  later.length ? `<ul class="folds">${later.map((l) => fold(l.title ?? l.name ?? l, l.detail)).join('')}</ul>` : '<p class="quiet">Nothing waiting.</p>',
  pending.length
    ? `<h3>Decided for you, override if you disagree <span class="count">${pending.length}</span></h3><ul class="rows">${pending.map(pendingRow).join('')}</ul>`
    : '',
  ideas.length
    ? `<h3>Ideas <span class="count">${ideas.length}</span></h3><ul class="folds">${ideas.map((i) => (typeof i === 'string' ? `<li>${inline(i)}</li>` : fold(i.name ?? i.title, i.detail))).join('')}</ul>`
    : '',
].join('')

// By area: counts and the latest decisions, newest day first.
const areaNames = [...areas.map(([name]) => name), 'Other']
const today = decisions[0]?.day
const areaCards = areaNames
  .map((name) => {
    const own = decisions.filter((d) => d.areas.includes(name))
    const lands = landed.filter((l) => l.areas.includes(name))
    if (!own.length && !lands.length) return ''
    const todayCount = own.filter((d) => d.day === today).length
    const latest = own
      .filter((d) => d.areas[0] === name)
      .slice(0, 2)
      .map((d) => `<li>${inline(d.text.length > 120 ? `${d.text.slice(0, 118)}…` : d.text)}</li>`)
      .join('')
    return `<button class="area" data-area="${esc(name)}"><span class="area-head"><strong>${esc(name)}</strong><span class="meta">${own.length} decisions${todayCount ? ` · ${todayCount} today` : ''}${lands.length ? ` · ${lands.length} landed` : ''}</span></span><ul>${latest}</ul></button>`
  })
  .join('')

// Decisions grouped by day, newest first; the latest day starts open.
const days = Map.groupBy(decisions, (d) => d.day)
const decisionRow = (d) =>
  `<li class="filterable decision" data-areas="${esc(d.areas.join('|'))}"><span class="time">${esc(d.time)}</span><span class="who${/^(tushar|owner)$/i.test(d.who) ? ' owner' : ''}">${esc(d.who)}</span><span class="text">${inline(d.text)}<span class="tags">${tags(d.areas)}</span></span></li>`
const decisionDays = [...days]
  .map(
    ([day, items], index) =>
      `<details class="day" data-day="${esc(day)}"${index === 0 ? ' open' : ''}><summary><strong>${esc(dayLabel(day))}</strong> <span class="count n">${items.length}</span></summary><ul class="rows">${items.map(decisionRow).join('')}</ul></details>`,
  )
  .join('')
const chips = ['All', ...areaNames]
  .map((name) => {
    const count = name === 'All' ? decisions.length : decisions.filter((d) => d.areas.includes(name)).length
    return `<button class="chip" data-area="${name === 'All' ? '' : esc(name)}">${esc(name)}<span class="n">${count}</span></button>`
  })
  .join('')
const filterBar = `<div class="filters"><input id="q" type="search" placeholder="Search decisions and landed work" autocomplete="off"><div class="chips">${chips}</div><p class="meta" id="result"></p></div>`

const header = `<header><h1>Juno status</h1><p class="meta">${updated ? `Updated ${esc(clock(updated))} IST, ${ago(updated)}` : 'No now.json yet'} · page built ${esc(clock(new Date()))} IST</p></header>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Juno status</title>
<style>${readCss()}</style>
</head>
<body><main>
${header}
${needs.length ? section('needs', 'Needs you', needsBody, needs.length) : '<p class="all-clear">Nothing needs you.</p>'}
${section('running', 'Now running', runningBody, running.length)}
${section('build', 'Build', buildBody)}
${section('landed', 'Recently landed on main', landedBody)}
${section('next', 'Next', nextBody, nextItems.length)}
${section('later', 'When you have time', laterBody, later.length)}
${section('areas', 'By area', `<div class="areas">${areaCards}</div>`)}
${section('decisions', 'Decisions', filterBar + decisionDays, decisions.length)}
</main>
<script>${clientScript}</script>
</body></html>
`

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'index.html'), html)

function readCss() {
  return `
:root { color-scheme: light dark; --bg: #faf9f6; --fg: #1f1e1b; --muted: #6b675f; --line: #e7e3da; --card: #fff; --accent: #b8432a; --soft: #fbebe5; --chip: #f0ede6; --green: #2f7a4a; }
@media (prefers-color-scheme: dark) { :root { --bg: #171614; --fg: #ebe7de; --muted: #a39e93; --line: #2e2c28; --card: #1f1e1b; --accent: #f08a72; --soft: #3a241e; --chip: #2a2825; --green: #7cc596; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 980px; margin: 0 auto; padding: 40px 28px 96px; }
header { margin-bottom: 20px; }
h1 { font-size: 24px; line-height: 1.2; margin: 0 0 4px; }
h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 12px; }
h3 { font-size: 14px; margin: 24px 0 8px; }
section { padding: 28px 0; border-top: 1px solid var(--line); }
p { margin: 0; }
.count { display: inline-block; background: var(--chip); color: var(--fg); border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 500; letter-spacing: 0; }
.meta, .time, .quiet { color: var(--muted); }
.meta { font-size: 13px; }
.time { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 13px; }
.all-clear { padding: 14px 0; border-top: 1px solid var(--line); color: var(--green); font-weight: 500; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; background: var(--chip); border-radius: 4px; padding: 1px 5px; }
ul, ol { margin: 0; padding: 0; }
.cards { list-style: none; display: grid; gap: 10px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
.card strong { font-weight: 550; }
.card p { margin-top: 4px; color: var(--muted); max-width: 80ch; }
.card.needs { border-color: var(--accent); background: var(--soft); }
.plain { padding-left: 20px; max-width: 80ch; }
.plain li { margin: 6px 0; }
.stats { display: grid; gap: 8px; }
.stat { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.label { width: 88px; flex: none; font-weight: 600; font-size: 13px; }
.rows { list-style: none; }
.rows > li { border-top: 1px solid var(--line); }
.rows > li:first-child { border-top: 0; }
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: '›'; display: inline-block; width: 14px; color: var(--muted); transition: transform .15s; }
details[open] > summary::before { transform: rotate(90deg); }
.landed summary, .landed .summary { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; flex-wrap: wrap; }
.landed .summary { padding-left: 14px; }
.landed .title { font-weight: 600; }
.sub { list-style: disc; padding: 0 0 10px 44px; color: var(--muted); font-size: 14px; max-width: 86ch; }
.sub .linked { color: var(--fg); }
.more > summary { padding: 8px 0; color: var(--muted); }
.folds { list-style: none; max-width: 86ch; }
.folds li { border-top: 1px solid var(--line); }
.folds li:first-child { border-top: 0; }
.folds summary { padding: 8px 0; }
.folds p { padding: 0 0 12px 14px; color: var(--muted); }
.areas { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.area { font: inherit; color: inherit; text-align: left; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.area:hover { border-color: var(--muted); }
.area.on { border-color: var(--accent); }
.area-head { display: grid; margin-bottom: 8px; }
.area ul { list-style: none; font-size: 13px; color: var(--muted); line-height: 1.45; }
.area li + li { margin-top: 6px; }
.filters { position: sticky; top: 0; z-index: 1; background: var(--bg); padding: 10px 0 12px; display: grid; gap: 10px; }
#q { font: inherit; width: 100%; max-width: 480px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); }
#q:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: 13px; color: var(--fg); background: var(--chip); border: 1px solid transparent; border-radius: 999px; padding: 2px 11px; }
.chip:hover { border-color: var(--line); }
.chip.on { background: var(--fg); color: var(--bg); }
.chip .n { color: var(--muted); margin-left: 4px; font-size: 12px; }
.chip.on .n { color: inherit; opacity: .7; }
.day { border-top: 1px solid var(--line); }
.day > summary { padding: 12px 0; font-size: 15px; }
.day .rows { padding-bottom: 12px; }
.decision { display: grid; grid-template-columns: 48px 140px minmax(0, 1fr); gap: 12px; padding: 9px 0; }
.who { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 1px; }
.who.owner { color: var(--accent); font-weight: 600; }
.text { max-width: 78ch; }
.tags { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 8px; vertical-align: 1px; }
.tag { font-size: 11px; line-height: 1.6; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; white-space: nowrap; }
[hidden] { display: none !important; }
.stale { color: var(--accent); }
@media (max-width: 640px) { .decision { grid-template-columns: 44px minmax(0, 1fr); } .who { grid-column: 2; } .text { grid-column: 1 / -1; } }
`
}
