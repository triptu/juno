// Explains where the time of a perf scenario went, from the files the perf
// spec writes with JUNO_PERF_TRACE (docs/performance.md 7.2).
//
//   node scripts/perf-trace.mjs <dir>/<name>.trace.json [measure]
//
// For every `juno.*` measure in the trace (or only `measure`), it sums the
// renderer main thread's self time by trace event inside the measure, and,
// when `<name>.cpuprofile` sits next to the trace, the JavaScript self time
// by function. Build with JUNO_UNMINIFIED=1 to read function names.

import { existsSync, readFileSync } from 'node:fs'

const [file, only] = process.argv.slice(2)
if (file === undefined) {
  console.error('usage: node scripts/perf-trace.mjs <trace.json> [measure]')
  process.exit(2)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
const events = Array.isArray(raw) ? raw : raw.traceEvents

const threadNames = new Map()
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name)
const main = [...threadNames].filter(([, name]) => name === 'CrRendererMain').map(([key]) => key)

// Measures are async user-timing events: a 'b' and an 'e' with the same id.
const open = new Map()
const measures = []
for (const e of events) {
  if (!e.cat?.includes('blink.user_timing') || !e.name.startsWith('juno.')) continue
  if (only !== undefined && e.name !== only) continue
  const key = `${e.name}:${e.id ?? e.id2?.local}`
  if (e.ph === 'b') open.set(key, e.ts)
  else if (e.ph === 'e' && open.has(key)) {
    measures.push({ name: e.name, start: open.get(key), end: e.ts, pid: e.pid })
    open.delete(key)
  }
}
measures.sort((a, b) => a.start - b.start)

// Self time per event name on the renderer main threads, as [start, end, name] spans.
const spans = []
for (const key of main) {
  const [pid, tid] = key.split(':').map(Number)
  const own = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && typeof e.dur === 'number').sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const stack = []
  for (const e of own) {
    while (stack.length > 0 && stack.at(-1).end <= e.ts) stack.pop()
    const parent = stack.at(-1)
    const span = { start: e.ts, end: e.ts + e.dur, name: e.name, self: e.dur, pid }
    if (parent !== undefined) parent.self -= Math.min(e.dur, parent.end - e.ts)
    stack.push(span)
    spans.push(span)
  }
}

const ms = (us) => (us / 1000).toFixed(1)
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)

const profilePath = file.replace(/\.trace\.json$/, '.cpuprofile')
const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : undefined
const samples = []
if (profile !== undefined) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  let t = profile.startTime
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] ?? 0
    t += delta
    const frame = nodes.get(profile.samples[i]).callFrame
    const where = frame.url === '' ? '' : ` ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`
    samples.push({ t, us: profile.timeDeltas[i + 1] ?? delta, label: `${frame.functionName || '(anonymous)'}${where}` })
  }
}

const byName = new Map()
for (const m of measures) byName.set(m.name, [...(byName.get(m.name) ?? []), m])
for (const [name, list] of byName) {
  const perEvent = new Map()
  const perFunction = new Map()
  let busy = 0
  for (const m of list) {
    for (const s of spans) {
      const overlap = Math.min(s.end, m.end) - Math.max(s.start, m.start)
      if (overlap <= 0 || s.self <= 0) continue
      const part = (s.self * overlap) / (s.end - s.start)
      perEvent.set(s.name, (perEvent.get(s.name) ?? 0) + part)
      busy += part
    }
    for (const sample of samples) {
      if (sample.t < m.start || sample.t > m.end) continue
      perFunction.set(sample.label, (perFunction.get(sample.label) ?? 0) + sample.us)
    }
  }
  const durations = list.map((m) => m.end - m.start).sort((a, b) => a - b)
  console.log(`\n${name}: n=${list.length}, median ${ms(durations[Math.floor(durations.length / 2)])} ms, main thread busy ${ms(busy / list.length)} ms per measure`)
  console.log('  main thread self time per measure, by event:')
  for (const [event, us] of top(perEvent, 15)) console.log(`    ${ms(us / list.length).padStart(7)} ms  ${event}`)
  if (perFunction.size > 0) {
    console.log('  JavaScript self time per measure, by function:')
    for (const [fn, us] of top(perFunction, 25)) console.log(`    ${ms(us / list.length).padStart(7)} ms  ${fn}`)
  }
}
if (measures.length === 0) console.log('no juno.* measures in the trace')
