/**
 * The labelling page: one message at a time with its conversation, and two
 * choices. Served by `pnpm notif:replay label`, which saves `labels.json`
 * next to it. Opened as a file, labels stay in the browser's storage.
 */
import type { Kind, ShownMessage } from './model'

export interface PageItem {
  readonly id: string
  readonly at: number
  readonly kind: Kind
  readonly where: string
  readonly sender: string
  readonly text: string
  readonly mentionsMe: boolean
  readonly threadRoot?: ShownMessage
  readonly before: ReadonlyArray<ShownMessage>
}

const STYLE = `:root {
  --bg: #f5f5f3; --surface: #ffffff; --sunken: #f0f0ee; --text: #1d1d1f; --muted: #6b6b70; --faint: #8e8e93;
  --line: rgba(0, 0, 0, 0.09); --press: rgba(0, 0, 0, 0.06); --hover: rgba(0, 0, 0, 0.035); --accent: #4a6f9c; --error: #b3261e;
  --mine: #eef2f7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1b1b1d; --surface: #252527; --sunken: #2c2c2f; --text: #ececee; --muted: #a3a3a8; --faint: #8c8c91;
    --line: rgba(255, 255, 255, 0.1); --press: rgba(255, 255, 255, 0.09); --hover: rgba(255, 255, 255, 0.05); --accent: #8fb0d8; --error: #f2b8b5;
    --mine: #2b313a;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--text); cursor: default;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { height: 100%; max-width: 720px; margin: 0 auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
h1 { font-size: 15px; font-weight: 600; margin: 0; }
.progress { color: var(--muted); font-variant-numeric: tabular-nums; }
.bar { height: 2px; background: var(--line); border-radius: 1px; overflow: hidden; margin-top: -8px; }
.bar > div { height: 100%; background: var(--accent); width: 0; }
.card { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.place { padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; }
.place b { font-weight: 600; }
.place span { color: var(--muted); }
.context { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px; scrollbar-gutter: stable; }
.label { color: var(--faint); font-size: 12px; margin: 10px 0 2px; }
.msg { padding: 6px 0; }
.msg .who { font-weight: 600; }
.msg .when { color: var(--faint); font-size: 12px; margin-left: 6px; font-variant-numeric: tabular-nums; }
.msg .text { white-space: pre-wrap; overflow-wrap: anywhere; }
.context .msg .text { color: var(--muted); }
.msg.mine { background: var(--mine); margin: 2px -8px; padding: 6px 8px; border-radius: 6px; }
.empty { color: var(--faint); padding: 8px 0; }
.new { border-top: 1px solid var(--line); padding: 12px 16px 14px; background: var(--sunken); max-height: 55%; overflow-y: auto; }
.new .text { font-size: 15px; }
.tag { color: var(--accent); font-size: 12px; margin-left: 6px; }
.choices { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
button {
  font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; cursor: default;
}
button:hover { background: var(--hover); }
button:active { background: var(--press); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: 0.4; }
.choice { height: 64px; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 10px; }
kbd { font: 12px ui-monospace, "SF Mono", monospace; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; font-weight: 400; }
footer { display: flex; justify-content: space-between; align-items: center; color: var(--muted); min-height: 28px; }
.undo { padding: 4px 10px; display: flex; gap: 8px; align-items: center; }
.status.error { color: var(--error); }
.done { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 24px; }
.done code { font: 12px ui-monospace, "SF Mono", monospace; background: var(--sunken); padding: 8px 10px; border-radius: 6px; overflow-wrap: anywhere; user-select: all; }
`

/** The page's behaviour: one unlabelled message at a time, N, D and U, saved through the label server. */
const SCRIPT = `const { items, commands } = JSON.parse(document.getElementById('data').textContent)
const served = location.protocol.startsWith('http')
const storeKey = 'notif-labels:' + items.length + ':' + (items[0] ? items[0].id : '')
let labels = JSON.parse(localStorage.getItem(storeKey) || '{}')
const $ = (id) => document.getElementById(id)

const kinds = { dm: 'Direct message', 'group DM': 'Group DM', thread: 'Thread reply', channel: 'Channel' }
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const when = (at) => day.format(at) + ', ' + clock.format(at)
const gap = (from, to) => {
  const minutes = Math.round((to - from) / 60000)
  if (minutes < 1) return 'less than a minute later'
  if (minutes < 60) return minutes === 1 ? 'a minute later' : minutes + ' minutes later'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour later' : hours + ' hours later'
  const days = Math.round(hours / 24)
  return days === 1 ? 'a day later' : days + ' days later'
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function message(m, tag) {
  const node = el('div', 'msg' + (m.fromMe ? ' mine' : ''))
  const head = el('div')
  head.append(el('span', 'who', m.sender), el('span', 'when', when(m.at)))
  if (tag) head.append(el('span', 'tag', tag))
  node.append(head, el('div', 'text', m.text || '(no text)'))
  return node
}

const current = () => items.find((item) => !labels[item.id])

function render() {
  const count = Object.keys(labels).filter((id) => items.some((item) => item.id === id)).length
  $('progress').textContent = count + ' of ' + items.length
  $('bar').style.width = (100 * count / Math.max(1, items.length)) + '%'
  $('undo').disabled = count === 0
  const item = current()
  const card = $('card')
  card.replaceChildren()
  $('notify').disabled = $('stay').disabled = item === undefined
  if (item === undefined) {
    const done = el('div', 'done')
    done.append(el('div', '', 'All ' + items.length + ' labelled. To see the results, run:'), el('code', '', commands.report))
    card.append(done)
    return
  }
  const place = el('div', 'place')
  const left = el('div')
  left.append(el('b', '', item.where))
  place.append(left, el('span', '', kinds[item.kind]))
  const context = el('div', 'context')
  if (item.threadRoot) {
    context.append(el('div', 'label', 'Thread started with'), message(item.threadRoot))
  }
  if (item.before.length > 0) {
    context.append(el('div', 'label', item.threadRoot ? 'Earlier replies' : 'Earlier'))
    for (const m of item.before) context.append(message(m))
  } else if (!item.threadRoot) {
    context.append(el('div', 'empty', 'Nothing earlier in this conversation.'))
  }
  const last = item.before.length > 0 ? item.before[item.before.length - 1].at : item.threadRoot ? item.threadRoot.at : undefined
  const fresh = el('div', 'new')
  fresh.append(el('div', 'label', last === undefined ? 'The message' : 'The message, ' + gap(last, item.at)))
  fresh.append(message({ sender: item.sender, text: item.text, at: item.at, fromMe: false }, item.mentionsMe ? 'mentions you' : ''))
  card.append(place, context, fresh)
  context.scrollTop = context.scrollHeight
}

let saving = Promise.resolve()
function save() {
  localStorage.setItem(storeKey, JSON.stringify(labels))
  if (!served) return
  const body = JSON.stringify(labels)
  saving = saving.then(() => fetch('/labels', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }))
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status))
      setStatus('')
    })
    .catch(() => setStatus("Couldn't save to labels.json. Your labels are kept in this browser; check the terminal.", true))
}

function setStatus(text, error) {
  $('status').textContent = text
  $('status').className = 'status' + (error ? ' error' : '')
}

function choose(label) {
  const item = current()
  if (item === undefined) return
  labels[item.id] = { label, at: new Date().toISOString() }
  save()
  render()
}

function undo() {
  const ids = Object.keys(labels).filter((id) => items.some((item) => item.id === id))
  if (ids.length === 0) return
  const lastId = ids.reduce((a, b) => (labels[a].at >= labels[b].at ? a : b))
  delete labels[lastId]
  save()
  render()
}

$('notify').addEventListener('click', () => choose('notify'))
$('stay').addEventListener('click', () => choose('stay'))
$('undo').addEventListener('click', undo)
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'n') choose('notify')
  else if (key === 'd') choose('stay')
  else if (key === 'u') undo()
  else return
  event.preventDefault()
})

async function start() {
  if (served) {
    try {
      const response = await fetch('/labels')
      if (response.ok) labels = { ...labels, ...(await response.json()) }
    } catch {
      setStatus("Couldn't read labels.json.", true)
    }
  } else {
    setStatus('Opened as a file, so labels stay in this browser. To save them to labels.json, run: ' + commands.serve)
  }
  render()
}
start()
`

export function page(items: ReadonlyArray<PageItem>, commands: { readonly serve: string; readonly report: string }): string {
  const data = JSON.stringify({ items, commands }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Label notifications</title>
<style>
${STYLE}</style>
</head>
<body>
<main>
  <header><h1>Should this have notified you?</h1><span class="progress" id="progress"></span></header>
  <div class="bar"><div id="bar"></div></div>
  <section class="card" id="card"></section>
  <div class="choices">
    <button class="choice" id="notify">Notify <kbd>N</kbd></button>
    <button class="choice" id="stay">Don't notify <kbd>D</kbd></button>
  </div>
  <footer><span class="status" id="status"></span><button class="undo" id="undo">Undo <kbd>U</kbd></button></footer>
</main>
<script type="application/json" id="data">${data}</script>
<script>
${SCRIPT}</script>
</body>
</html>
`
}
