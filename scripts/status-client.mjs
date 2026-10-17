// The status page's inline script: search and area filter (kept in the URL
// hash), open days kept across reloads, relative times, and a reload every 20 s.

export const clientScript = `
const q = document.getElementById('q')
const result = document.getElementById('result')
const items = [...document.querySelectorAll('.filterable')].map((el) => ({
  el, areas: el.dataset.areas.split('|'), text: el.textContent.toLowerCase(), decision: el.classList.contains('decision'),
}))
const days = [...document.querySelectorAll('details.day')]
const saved = JSON.parse(sessionStorage.getItem('openDays') || 'null')
const openDays = new Set(saved ?? days.filter((d) => d.open).map((d) => d.dataset.day))
let area = ''
let filtering = false

const hash = new URLSearchParams(location.hash.slice(1))
area = hash.get('area') ?? ''
q.value = hash.get('q') ?? ''

function apply() {
  const terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean)
  filtering = Boolean(area || terms.length)
  let shown = 0
  let total = 0
  for (const it of items) {
    const ok = (!area || it.areas.includes(area)) && terms.every((t) => it.text.includes(t))
    it.el.hidden = !ok
    if (it.decision) { total++; if (ok) shown++ }
  }
  for (const d of days) {
    const n = d.querySelectorAll('.decision:not([hidden])').length
    d.hidden = n === 0
    d.querySelector('.n').textContent = n
    d.open = filtering || openDays.has(d.dataset.day)
  }
  for (const more of document.querySelectorAll('details.more')) more.open = filtering && !!more.querySelector('.filterable:not([hidden])')
  for (const el of document.querySelectorAll('[data-area]')) el.classList.toggle('on', el.dataset.area === area && (area !== '' || el.classList.contains('chip')))
  result.textContent = filtering ? shown + ' of ' + total + ' decisions' + (area ? ' in ' + area : '') : ''
  const params = new URLSearchParams()
  if (area) params.set('area', area)
  if (q.value) params.set('q', q.value)
  history.replaceState(null, '', params.size ? '#' + params : location.pathname)
}

for (const d of days) d.addEventListener('toggle', () => {
  if (filtering) return
  if (d.open) openDays.add(d.dataset.day); else openDays.delete(d.dataset.day)
  sessionStorage.setItem('openDays', JSON.stringify([...openDays]))
})
for (const el of document.querySelectorAll('[data-area]')) el.addEventListener('click', () => {
  area = el.dataset.area === area && el.classList.contains('area') ? '' : el.dataset.area
  apply()
  if (el.classList.contains('area')) document.getElementById('decisions').scrollIntoView({ behavior: 'smooth' })
})
let lastKey = 0
q.addEventListener('input', () => { lastKey = Date.now(); apply() })
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus() }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; apply(); q.blur() }
})

function ago() {
  for (const el of document.querySelectorAll('[data-ts]')) {
    const min = Math.round((Date.now() - Number(el.dataset.ts)) / 60000)
    el.textContent = min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.round(min / 60) + ' h ago'
    el.classList.toggle('stale', min > 180)
  }
}

apply()
ago()
const y = Number(sessionStorage.getItem('scrollY'))
if (y) scrollTo(0, y)
setInterval(() => {
  ago()
  if (Date.now() - lastKey < 10000) return
  sessionStorage.setItem('scrollY', String(scrollY))
  location.reload()
}, 20000)
`
