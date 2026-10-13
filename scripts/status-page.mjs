// Builds a local status page: what needs the owner, what is running, the
// decision log and recent commits. Output: .juno-status/index.html (gitignored).
//
//   node scripts/status-page.mjs
//
// Inputs:
//   .juno-status/now.json   { "updated": "...", "needsYou": [{ "title", "detail" }],
//                             "running": [{ "name", "model", "detail", "since" }],
//                             "next": ["..."] }   (local, not committed)
//   docs/decision-log.md    the committed decision log
//   git log --all           recent commits on every branch, including agent worktrees
//
// A git post-commit hook runs this, so commits show up on their own. The page
// reloads itself every 20 seconds.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.juno-status')
mkdirSync(outDir, { recursive: true })

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

const nowPath = join(outDir, 'now.json')
const now = existsSync(nowPath) ? JSON.parse(readFileSync(nowPath, 'utf8')) : { needsYou: [], running: [], next: [] }

const healthPath = join(outDir, 'health.json')
const health = existsSync(healthPath) ? JSON.parse(readFileSync(healthPath, 'utf8')) : undefined

const logPath = join(root, 'docs/decision-log.md')
const decisions = existsSync(logPath)
  ? readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => {
        const [when, who, ...rest] = line.slice(2).split(' · ')
        return { when, who, text: rest.join(' · ') }
      })
  : []

let commits = []
try {
  const raw = execFileSync(
    'git',
    ['log', '--all', '-n', '60', '--date=format:%m-%d %H:%M', '--format=%ad%x1f%h%x1f%D%x1f%s'],
    { cwd: root, encoding: 'utf8' },
  )
  commits = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [when, hash, refs, subject] = line.split('\x1f')
      const branch = /worktree-agent-/.test(refs) ? 'agent branch' : /\bmain\b/.test(refs) ? 'main' : ''
      return { when, hash, branch, subject }
    })
} catch {
  commits = []
}

const generated = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const section = (title, body, count) =>
  `<section><h2>${esc(title)}${count != null ? ` <span class="count">${count}</span>` : ''}</h2>${body}</section>`

const needs = now.needsYou?.length
  ? `<ul class="cards">${now.needsYou
      .map((n) => `<li class="card needs"><strong>${inline(n.title)}</strong>${n.detail ? `<p>${inline(n.detail)}</p>` : ''}</li>`)
      .join('')}</ul>`
  : `<p class="empty">Nothing needs you right now.</p>`

const running = now.running?.length
  ? `<ul class="cards">${now.running
      .map(
        (r) =>
          `<li class="card"><div class="row"><strong>${inline(r.name)}</strong><span class="meta">${esc(r.model ?? '')}${r.since ? ` · since ${esc(r.since)}` : ''}</span></div>${r.detail ? `<p>${inline(r.detail)}</p>` : ''}</li>`,
      )
      .join('')}</ul>`
  : `<p class="empty">No agents running.</p>`

const next = now.next?.length ? `<ol class="next">${now.next.map((n) => `<li>${inline(n)}</li>`).join('')}</ol>` : ''

const healthBody = health
  ? (() => {
      const c = health.counts ?? {}
      const items = [
        ['Unused files', c.unusedFiles],
        ['Unused exports', c.unusedExports],
        ['Unused types', c.unusedTypes],
        ['Unused dependencies', c.unusedDependencies],
        ['Duplication', `${health.duplication?.percentage ?? '?'}%`],
        ['Files over 400 lines', c.oversizedFiles],
        ['Functions over 80 lines', c.oversizedFunctions],
      ]
      return `<table>${items.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="time">${esc(v ?? '?')}</td></tr>`).join('')}</table><p class="meta">From \`pnpm health\` (report-only) at ${esc(new Date(health.timestamp).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }))}.</p>`
    })()
  : '<p class="empty">Run <code>pnpm health</code> to fill this in.</p>'

const decisionRows = decisions
  .map(
    (d) =>
      `<tr><td class="time">${esc(d.when)}</td><td class="who ${d.who === 'Tushar' ? 'owner' : ''}">${esc(d.who)}</td><td>${inline(d.text)}</td></tr>`,
  )
  .join('')

const commitRows = commits
  .map(
    (c) =>
      `<tr><td class="time">${esc(c.when)}</td><td class="hash">${esc(c.hash)}</td><td>${c.branch === 'agent branch' ? '<span class="tag">agent branch</span> ' : ''}${esc(c.subject)}</td></tr>`,
  )
  .join('')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="20">
<title>Juno status</title>
<style>
  :root { color-scheme: light dark; --bg: #fbf9f3; --fg: #1d1c17; --muted: #6f6c63; --line: #ebe6d8; --card: #fff; --accent: #cc4628; --soft: #fbe9e4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161513; --fg: #ece8de; --muted: #a29d91; --line: #2a2825; --card: #1e1d1a; --accent: #ff8a73; --soft: #3a231d; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
  header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; }
  h1 { font: 600 22px/1.2 -apple-system, system-ui, sans-serif; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 10px; }
  .count { background: var(--line); color: var(--fg); border-radius: 999px; padding: 1px 8px; font-size: 12px; letter-spacing: 0; }
  .meta, .time, .hash, .empty { color: var(--muted); }
  .time, .hash { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .hash { font-family: ui-monospace, monospace; font-size: 12px; }
  .cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .card p { margin: 4px 0 0; color: var(--muted); }
  .card.needs { border-color: var(--accent); background: var(--soft); }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .next { margin: 0; padding-left: 20px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); vertical-align: top; }
  .who { white-space: nowrap; color: var(--muted); }
  .who.owner { color: var(--accent); font-weight: 600; }
  .tag { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; color: var(--muted); }
  code { font-family: ui-monospace, monospace; font-size: 12px; background: var(--line); border-radius: 4px; padding: 0 4px; }
</style>
</head>
<body><main>
<header><h1>Juno status</h1><span class="meta">updated ${esc(now.updated ?? generated)} · page built ${esc(generated)} · reloads every 20 s</span></header>
${section('Needs you', needs, now.needsYou?.length ?? 0)}
<div class="grid">
  <div>${section('Running now', running, now.running?.length ?? 0)}${next ? section('Up next', next) : ''}${section('Codebase health', healthBody)}</div>
  <div>${section('Decisions', `<table>${decisionRows}</table>`, decisions.length)}</div>
</div>
${section('Commits', `<table>${commitRows}</table>`, commits.length)}
</main></body></html>
`

writeFileSync(join(outDir, 'index.html'), html)
