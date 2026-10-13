// The motif kit for approach C (and a vocabulary element for approach D).
// Each motif is hand-drawn in the vocabulary: a 40 x 40 grid, the drawing
// inside 7..33, stroke 3 with round caps and joins, `soft` for one flat
// fill, `accent` for at most one small highlight, `ink` for filled dots.
// Elements marked detail="1" drop below 20px.
//
// Names are what the model chooses from, so they are plain workplace words.

const el = (tag, attrs) => ({ tag, attrs })
const path = (d, extra = {}) => el('path', { d, ...extra })
const circle = (cx, cy, r, extra = {}) => el('circle', { cx: String(cx), cy: String(cy), r: String(r), ...extra })
const line = (x1, y1, x2, y2, extra = {}) => el('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), ...extra })
const rect = (x, y, w, h, rx, extra = {}) => el('rect', { x: String(x), y: String(y), width: String(w), height: String(h), rx: String(rx), ...extra })
const ellipse = (cx, cy, rx, ry, extra = {}) => el('ellipse', { cx: String(cx), cy: String(cy), rx: String(rx), ry: String(ry), ...extra })
const D = { detail: '1' }
const soft = { fill: 'soft' }
const inkDot = { fill: 'ink', stroke: 'none' }
const accentDot = { fill: 'accent', stroke: 'none' }

function starPoints(cx, cy, ro, ri, n = 5) {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri
    const a = -Math.PI / 2 + (i * Math.PI) / n
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}
function rays(cx, cy, r1, r2, n, extra = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n
    out.push(line((cx + r1 * Math.cos(a)).toFixed(1), (cy + r1 * Math.sin(a)).toFixed(1), (cx + r2 * Math.cos(a)).toFixed(1), (cy + r2 * Math.sin(a)).toFixed(1), extra))
  }
  return out
}

const def = (about, elements) => ({ about, elements })

export const motifs = {
  // Data and systems
  database: def('a database, storage, migration source', [
    path('M10 12 V28 A10 4 0 0 0 30 28 V12'),
    path('M10 20 A10 4 0 0 0 30 20', D),
    ellipse(20, 12, 10, 4, soft),
  ]),
  server: def('servers, infrastructure, hosting, environments', [
    rect(9, 9, 22, 9, 3, soft), rect(9, 22, 22, 9, 3),
    circle(14, 13.5, 1.6, accentDot), circle(14, 26.5, 1.6, inkDot),
  ]),
  cloud: def('cloud, hosting, cloud bill', [
    path('M12 30 H28 A6 6 0 0 0 28 18 A8 8 0 0 0 12.5 20 A5 5 0 0 0 12 30 Z', soft),
  ]),
  code: def('code, pull requests, programming', [
    path('M14 13 L7 20 L14 27'), path('M26 13 L33 20 L26 27'), line(22, 10, 18, 30, D),
  ]),
  terminal: def('terminal, command line, scripts', [
    rect(7, 10, 26, 20, 4, soft), path('M12 16 L17 20 L12 24'), line(20, 24, 27, 24),
  ]),
  branch: def('git branch, merge, versions', [
    path('M13 13.5 V26.5'), path('M27 17.5 C27 24 13 21 13 26.5'),
    circle(13, 10, 3.5, soft), circle(13, 30, 3.5, soft), circle(27, 14, 3.5, accentDot),
  ]),
  bug: def('bug, flaky test, defect', [
    ellipse(20, 22, 8, 9, soft), circle(20, 11, 4, soft),
    line(12, 18, 7, 15), line(12, 24, 7, 24), line(12, 30, 8, 33),
    line(28, 18, 33, 15), line(28, 24, 33, 24), line(28, 30, 32, 33),
    line(20, 14, 20, 31, D),
  ]),
  gear: def('settings, configuration, maintenance, process', [
    circle(20, 20, 6, soft), ...rays(20, 20, 9.5, 12.5, 8, { 'stroke-width': '4' }),
  ]),
  lock: def('security, locked, permissions, state lock', [
    rect(10, 18, 20, 14, 4, soft), path('M14 18 V13 A6 6 0 0 1 26 13 V18'), circle(20, 25, 2, inkDot),
  ]),
  unlock: def('unlocked, access granted, released', [
    rect(10, 18, 20, 14, 4, soft), path('M14 18 V12 A6 6 0 0 1 26 12 V14'), circle(20, 25, 2, inkDot),
  ]),
  key: def('keys, credentials, access, secrets', [
    circle(14, 22, 6, soft), path('M18.5 17.5 L31 9'), path('M26 12 L29 15'), path('M23 14.5 L26 17.5', D),
  ]),
  shield: def('protection, security review, compliance', [
    path('M20 8 L31 12 V20 C31 27 26 31 20 33 C14 31 9 27 9 20 V12 Z', soft), path('M15 20 L19 24 L26 16', D),
  ]),
  layers: def('stack, layers, architecture, tiers', [
    path('M20 9 L33 16 L20 23 L7 16 Z', soft), path('M7 22 L20 29 L33 22', D),
  ]),
  link: def('links, connections, integrations, references', [
    path('M17 23 L23 17'), path('M14.5 19.5 L11 23 A4.5 4.5 0 0 0 17 29 L20.5 25.5'), path('M25.5 20.5 L29 17 A4.5 4.5 0 0 0 23 11 L19.5 14.5'),
  ]),
  refresh: def('retry, rotation, handoff, cycle, sync', [
    path('M29 16 A10 10 0 1 0 31 23'), path('M30 9 V16 H23'),
  ]),
  bolt: def('speed, power, hotfix, outage', [
    path('M22 7 L11 22 H19 L17 33 L29 18 H21 Z', soft),
  ]),
  wrench: def('fix, tooling, repair, maintenance', [
    path('M26 8 A7 7 0 0 0 19 17 L8 28 L12 32 L23 21 A7 7 0 0 0 32 14 L28 18 L24 14 Z', soft),
  ]),
  // Measurement and money
  'chart-bars': def('growth, numbers, metrics rising', [
    line(11, 30, 11, 22, { 'stroke-width': '4' }), line(20, 30, 20, 16, { 'stroke-width': '4' }), line(29, 30, 29, 10, { 'stroke-width': '4' }),
  ]),
  'chart-up': def('a rising trend, a cost or metric going up', [
    path('M9 28 L16 20 L22 24 L31 12'), circle(31, 12, 2.6, accentDot),
  ]),
  'chart-down': def('a falling trend, a drop, a regression recovering', [
    path('M9 12 L16 20 L22 16 L31 28'), circle(31, 28, 2.6, accentDot),
  ]),
  pie: def('share, breakdown, allocation, pipeline mix', [
    path('M20 20 V9 A11 11 0 0 1 29.5 25.5 Z', { fill: 'soft', stroke: 'none' }), circle(20, 20, 11), path('M20 9 V20 L29.5 25.5'),
  ]),
  target: def('goal, target, OKR, focus', [
    circle(20, 20, 11), circle(20, 20, 6.5, D), circle(20, 20, 2.2, accentDot),
  ]),
  coins: def('money, budget, cost, bill, pricing', [
    path('M11 26 V14'), path('M29 26 V14'), path('M11 26 A9 3.5 0 0 0 29 26'),
    path('M11 20 A9 3.5 0 0 0 29 20', D), ellipse(20, 14, 9, 3.5, soft),
  ]),
  dollar: def('price, revenue, a deal', [
    circle(20, 20, 12, soft), path('M23.5 15 H18.5 A2.6 2.6 0 0 0 18.5 20 H21.5 A2.6 2.6 0 0 1 21.5 25 H16.5'), line(20, 12.5, 20, 27.5, D),
  ]),
  receipt: def('an invoice, a bill, expenses', [
    path('M11 8 H29 V31 L26 28 L23 31 L20 28 L17 31 L14 28 L11 31 Z', soft), line(16, 15, 24, 15, D), line(16, 21, 24, 21, D),
  ]),
  tag: def('pricing, labels, a release tag', [
    path('M9 9 H20 L32 21 L21 32 L9 20 Z', soft), circle(15, 15, 2, inkDot),
  ]),
  // Time
  calendar: def('a date, scheduling, a meeting', [
    rect(9, 11, 22, 20, 4, soft), line(9, 17, 31, 17), line(14, 8, 14, 13), line(26, 8, 26, 13), circle(20, 24, 2, accentDot),
  ]),
  'calendar-check': def('a scheduled event confirmed, a deadline met', [
    rect(9, 11, 22, 20, 4, soft), line(9, 17, 31, 17), line(14, 8, 14, 13), line(26, 8, 26, 13), path('M15 24 L19 28 L26 21'),
  ]),
  clock: def('time, duration, waiting, a deadline', [
    circle(20, 20, 11, soft), path('M20 13 V20 L25 23'),
  ]),
  hourglass: def('time running out, a freeze window', [
    path('M12 8 H28 V12 L21 20 L28 28 V32 H12 V28 L19 20 L12 12 Z'), path('M16 28 L20 24 L24 28 Z', { fill: 'soft', stroke: 'none', detail: '1' }),
  ]),
  moon: def('night, late hours, 2am, on-call', [
    path('M24 8 A12 12 0 1 0 32 24 A9 9 0 0 1 24 8 Z', soft), circle(29, 11, 1.8, { ...accentDot, detail: '1' }),
  ]),
  sun: def('morning, daytime, a sunny mood', [
    circle(20, 20, 6, soft), ...rays(20, 20, 9.5, 12.5, 8),
  ]),
  // People
  person: def('one person, a profile, a candidate', [
    circle(20, 13, 5, soft), path('M10 32 C10 24 14 21 20 21 C26 21 30 24 30 32'),
  ]),
  people: def('a team, a group, participants, headcount', [
    circle(15, 14, 4.5, soft), path('M7 31 C7 24 10.5 21 15 21 C19.5 21 23 24 23 31'),
    circle(27, 15, 3.5, { ...soft, detail: '1' }), path('M24 29 C25 24.5 26 23 27.5 23 C31 23 33 26 33 31', D),
  ]),
  'id-card': def('hiring, a candidate, an employee record, an interview', [
    rect(8, 11, 24, 18, 4, soft), circle(15, 19, 3), line(21, 17, 27, 17), line(21, 22, 26, 22, D),
  ]),
  chair: def('a seat, a role to fill, an interview', [
    path('M11 20 V13 A9 9 0 0 1 29 13 V20'), rect(8, 20, 24, 8, 3, soft), line(11, 28, 11, 32), line(29, 28, 29, 32),
  ]),
  chat: def('a conversation, a discussion, feedback', [
    path('M12 9 H28 Q32 9 32 13 V22 Q32 26 28 26 H19 L13 31 V26 H12 Q8 26 8 22 V13 Q8 9 12 9 Z', soft),
    circle(15, 17.5, 1.6, { ...inkDot, detail: '1' }), circle(20, 17.5, 1.6, { ...inkDot, detail: '1' }), circle(25, 17.5, 1.6, { ...inkDot, detail: '1' }),
  ]),
  megaphone: def('an announcement, a launch, marketing', [
    path('M8 16 V24 H13 L26 31 V9 L13 16 Z', soft), path('M29 15 A6 6 0 0 1 29 25', D),
  ]),
  // Documents and places
  document: def('a doc, a plan, a write-up, notes', [
    path('M12 8 H23 L29 14 V32 H12 Z', soft), path('M23 8 V14 H29'), line(16, 21, 25, 21, D), line(16, 26, 25, 26, D),
  ]),
  folder: def('files, a project, a collection', [
    path('M7 11 H16 L19 14 H33 V30 H7 Z', soft), line(7, 17, 33, 17, D),
  ]),
  list: def('a checklist, a list of items, an agenda', [
    circle(9.5, 12, 1.8, inkDot), line(15, 12, 31, 12), circle(9.5, 20, 1.8, inkDot), line(15, 20, 31, 20), circle(9.5, 28, 1.8, inkDot), line(15, 28, 31, 28),
  ]),
  rows: def('a list layout, rows, a table, a sidebar', [
    rect(8, 8, 24, 10, 3, soft), rect(8, 22, 24, 10, 3),
  ]),
  picture: def('an image, icons, visuals, design assets', [
    rect(8, 9, 24, 22, 4, soft), circle(15, 16, 2.4, accentDot), path('M8 27 L15 20 L21 26 L25 22 L32 29'),
  ]),
  pencil: def('writing, copy, editing, a draft', [
    path('M10 30 L12 24 L26 10 L30 14 L16 28 Z', soft), line(23, 13, 27, 17, D),
  ]),
  mail: def('email, a message sent, outreach', [
    rect(8, 11, 24, 18, 4, soft), path('M8 14 L20 23 L32 14'),
  ]),
  board: def('a presentation, a review, planning, a roadmap', [
    rect(7, 9, 26, 17, 3, soft), path('M12 21 L17 15 L22 18 L28 12', D), line(20, 26, 20, 32), path('M15 32 L20 26 L25 32'),
  ]),
  map: def('a location, travel, an offsite, directions', [
    path('M20 33 C14 26 11 21 11 16 A9 9 0 0 1 29 16 C29 21 26 26 20 33 Z', soft), circle(20, 16, 3, inkDot),
  ]),
  tent: def('an offsite, camping, a retreat', [
    path('M20 9 L34 31 H6 Z', soft), path('M15 31 L20 22 L25 31'),
  ]),
  home: def('home, remote work, the office', [
    path('M8 19 L20 8 L32 19 V31 H8 Z', soft), path('M16 31 V23 H24 V31', D),
  ]),
  box: def('a package, shipping, delivery, a release', [
    path('M8 15 L20 9 L32 15 V27 L20 33 L8 27 Z', soft), path('M8 15 L20 21 L32 15'), line(20, 21, 20, 33, D),
  ]),
  // Signals
  flag: def('a milestone, a flag, a feature flag', [
    line(11, 8, 11, 33), path('M11 10 H29 L25 16 L29 22 H11 Z', soft),
  ]),
  bell: def('alerts, notifications, reminders', [
    path('M12 24 V18 A8 8 0 0 1 28 18 V24 L31 28 H9 Z', soft), line(17, 32, 23, 32), circle(20, 9, 1.6, { ...inkDot, detail: '1' }),
  ]),
  warning: def('an incident, a risk, something broken', [
    path('M20 9 L33 31 H7 Z', soft), line(20, 17, 20, 23), circle(20, 27, 1.7, inkDot),
  ]),
  check: def('done, approved, resolved, shipped', [
    circle(20, 20, 11, soft), path('M14 20 L18.5 24.5 L27 15'),
  ]),
  cross: def('cancelled, cut, removed', [
    circle(20, 20, 11, soft), path('M15 15 L25 25'), path('M25 15 L15 25'),
  ]),
  plus: def('add, new, more', [
    circle(20, 20, 11, soft), line(20, 13, 20, 27), line(13, 20, 27, 20),
  ]),
  question: def('a question, unclear, undecided', [
    circle(20, 20, 11, soft), path('M16 16.5 A4 4 0 1 1 20 21 V23'), circle(20, 27.5, 1.6, inkDot),
  ]),
  magnifier: def('search, investigation, looking into something', [
    circle(17, 17, 8, soft), line(23, 23, 31, 31, { 'stroke-width': '3.5' }),
  ]),
  fire: def('urgent, hot, a fire to put out', [
    path('M20 8 C20 14 13 16 13 23 A7 7 0 0 0 27 23 C27 18 23 16 23 12 C22 15 19 15 20 8 Z', soft),
    path('M20 20 C20 23 17 24 17 27 A3 3 0 0 0 23 27 C23 24 20 23 20 20 Z', { fill: 'accent', stroke: 'none', detail: '1' }),
  ]),
  sparkle: def('something new, polish, AI, a nice touch', [
    path('M20 8 C21 15 25 19 32 20 C25 21 21 25 20 32 C19 25 15 21 8 20 C15 19 19 15 20 8 Z', soft), circle(30, 10, 2, { ...accentDot, detail: '1' }),
  ]),
  star: def('a favourite, quality, a highlight', [
    el('polygon', { points: starPoints(20, 21, 12, 5.5), fill: 'soft' }),
  ]),
  heart: def('appreciation, thanks, care', [
    path('M20 32 C8 24 6 16 11 11 C14 8 18 9 20 13 C22 9 26 8 29 11 C34 16 32 24 20 32 Z', soft),
  ]),
  'arrow-right': def('a move, a migration, next step, forward', [
    path('M9 20 H31'), path('M24 13 L31 20 L24 27'),
  ]),
  'arrow-up': def('up, increase, an upgrade', [
    path('M20 31 V9'), path('M13 16 L20 9 L27 16'),
  ]),
  rocket: def('a launch, shipping, a big release', [
    path('M20 7 C26 13 26 23 24 28 L16 28 C14 23 14 13 20 7 Z', soft), circle(20, 17, 2.6, accentDot),
    path('M16 23 L11 28 V31', D), path('M24 23 L29 28 V31', D), path('M18 31 L20 35 L22 31', { stroke: 'accent' }),
  ]),
  plane: def('travel, sending, a paper plane, a trip', [
    path('M8 20 L32 10 L24 32 L19 24 Z', soft), line(19, 24, 32, 10, D),
  ]),
  flask: def('an experiment, a test, a trial run', [
    path('M16 8 H24'), path('M17.5 8 V16 L10 28 A2.5 2.5 0 0 0 12 32 H28 A2.5 2.5 0 0 0 30 28 L22.5 16 V8'),
    path('M13 25 H27 L29.5 29 H10.5 Z', { fill: 'soft', stroke: 'none', detail: '1' }), circle(22, 24, 1.6, { ...accentDot, detail: '1' }),
  ]),
  scissors: def('cuts, trimming scope, removing things', [
    circle(12, 27, 4.5, soft), circle(12, 13, 4.5, soft), path('M15.5 24.5 L31 11'), path('M15.5 15.5 L31 29'),
  ]),
  alarm: def('an alarm, a scheduled alert, a recurring wake-up', [
    circle(20, 22, 10, soft), path('M20 16 V22 L24 25'), path('M8 12 L13 8'), path('M32 12 L27 8'),
  ]),
  briefcase: def('a job, a role, work, a candidate for a position', [
    rect(7, 13, 26, 18, 4, soft), path('M15 13 V10 A2 2 0 0 1 17 8 H23 A2 2 0 0 1 25 10 V13'), line(7, 21, 33, 21, D),
  ]),
  lightbulb: def('an idea, a proposal, a suggestion', [
    path('M14 22 A9 9 0 1 1 26 22 L25 27 H15 Z', soft), line(16, 31, 24, 31), line(18, 23, 22, 23, D),
  ]),
  // Social
  dice: def('games, play, chance, a social evening', [
    rect(8, 8, 24, 24, 6, soft), circle(14, 14, 2, inkDot), circle(20, 20, 2, inkDot), circle(26, 26, 2, inkDot),
    circle(26, 14, 2, { ...accentDot, detail: '1' }), circle(14, 26, 2, { ...accentDot, detail: '1' }),
  ]),
  cup: def('coffee, a chat over coffee, a break', [
    path('M9 14 H27 V24 A7 7 0 0 1 20 31 H16 A7 7 0 0 1 9 24 Z', soft), path('M27 16 H29 A4 4 0 0 1 29 24 H27'), line(16, 7, 16, 10, D), line(22, 7, 22, 10, D),
  ]),
  bowl: def('lunch, food, a meal together', [
    path('M7 18 H33 A13 13 0 0 1 20 31 A13 13 0 0 1 7 18 Z', soft), line(23, 6, 30, 18, D), line(28, 7, 33, 16, D),
  ]),
  plant: def('growth, wellbeing, something nurtured', [
    path('M20 33 V19'), path('M20 24 C14 24 11 20 10 15 C15 15 19 18 20 24 Z', soft), path('M20 20 C26 20 29 16 30 11 C25 11 21 14 20 20 Z', soft), line(13, 33, 27, 33),
  ]),
  globe: def('international, a region, the world, language', [
    circle(20, 20, 11, soft), ellipse(20, 20, 5, 11), line(9, 20, 31, 20, D),
  ]),
  camera: def('photos, screenshots, media', [
    rect(8, 13, 24, 18, 4, soft), circle(20, 22, 5), path('M15 13 L17 9 H23 L25 13', D),
  ]),
  phone: def('a call, mobile, a phone screen', [
    rect(12, 7, 16, 26, 4, soft), line(17, 28, 23, 28),
  ]),
  scale: def('legal, fairness, a decision between options, trade-offs', [
    line(20, 9, 20, 31), line(11, 31, 29, 31), line(10, 14, 30, 14),
    path('M5 22 L10 14 L15 22 A5 5 0 0 1 5 22 Z', soft), path('M25 22 L30 14 L35 22 A5 5 0 0 1 25 22 Z', soft),
  ]),
  trash: def('cleanup, deletion, removing old things', [
    path('M12 13 V31 H28 V13'), line(9, 13, 31, 13), path('M16 13 V9 H24 V13'), line(17, 18, 17, 27, D), line(23, 18, 23, 27, D),
  ]),
}

export const motifNames = Object.keys(motifs)
export const motifIndex = () => motifNames.map((n) => `${n}: ${motifs[n].about}`).join('\n')
