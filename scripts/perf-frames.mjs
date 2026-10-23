// Explains a scroll sweep's frame work, from the traces the perf spec writes
// with JUNO_PERF_TRACE (docs/performance.md 7.3).
//
//   bun scripts/perf-frames.mjs <dir>/<name>.trace.json [--top 20] [--frames 10] [--sequence <first frame>]
//
// Splits the renderer main thread's work per frame, measured as the scroll gate
// measures it (perfTrace.ts), into stages by self time: script, garbage
// collection, input, style, layout, prepaint, paint, layerize, commit, the
// caret and everything else. It prints the stages for all frames and for the
// frames over 8.3 ms, the events that cost most in those frames, the heaviest
// frames one by one, and the compositor, raster and GPU threads' busy time
// per frame beside them. `--sequence` prints 40 frames in order from the
// given one. Read sizes from traces without extra categories: invalidation
// tracking slows prepaint and DOM removal several times over.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg))
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : Number(args[at + 1])
}
if (file === undefined) {
  console.error('usage: bun scripts/perf-frames.mjs <trace.json> [--top 20] [--frames 10] [--sequence <first frame>]')
  process.exit(2)
}
const BUDGET = 8.3

const raw = JSON.parse(readFileSync(file, 'utf8'))
const events = Array.isArray(raw) ? raw : raw.traceEvents
const key = (e) => `${e.pid}:${e.tid}`
const threads = new Map()
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(key(e), e.args.name)

// The window's renderer is the main thread drawing the most frames, as in perfTrace.ts.
const frameCounts = new Map()
for (const e of events) if (e.ph === 'X' && e.name === 'ProxyMain::BeginMainFrame' && threads.get(key(e)) === 'CrRendererMain') frameCounts.set(key(e), (frameCounts.get(key(e)) ?? 0) + 1)
const main = [...frameCounts].toSorted((a, b) => b[1] - a[1])[0]?.[0]
if (main === undefined) throw new Error('Trace contains no renderer frames')
const rendererPid = Number(main.split(':')[0])

const complete = (k) => events.filter((e) => key(e) === k && e.ph === 'X' && typeof e.dur === 'number').toSorted((a, b) => a.ts - b.ts || b.dur - a.dur)
const own = complete(main)
const tasks = own.filter((e) => e.name === 'RunTask')
const frameStarts = own
  .filter((e) => e.name === 'ProxyMain::BeginMainFrame')
  .map((frame) => tasks.find((task) => task.ts <= frame.ts && frame.ts < task.ts + task.dur)?.ts ?? frame.ts)
  .toSorted((a, b) => a - b)
const start = events.find((e) => e.name === 'perf.sample.start')?.ts
const end = events.find((e) => e.name === 'perf.sample.end')?.ts
if (start === undefined || end === undefined) throw new Error('Trace is missing its measurement bounds')

// A stage is named by the event itself or, failing that, by its nearest
// ancestor with a stage: Chromium wraps each lifecycle step in
// `Blink.<Step>.UpdateTime`.
const STAGES = [
  ['caret', /^(WidgetBase::UpdateSelectionBounds|VisibleUnits|FrameSelection)/],
  ['gc', /(GC|Scavenge|MinorMS|BlinkGC|CppGC)/],
  ['script', /^(v8\.|V8\.(?!GC)|FunctionCall|EvaluateScript|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|FireIdleCallback|ParseHTML|HandlePostMessage)/],
  ['observers', /^(IntersectionObserver|ResizeObserver|Blink.IntersectionObservation)/],
  ['input', /^(HitTest|EventHandler|WidgetBaseInputHandler|WebFrameWidgetImpl::HandleInputEvent|InputHandlerProxy|Blink.HitTestDocumentUpdate)/],
  ['scroll', /^(ScrollLayer|PaintLayerScrollableArea|ScrollableArea)/],
  ['style', /^(Blink.Style.UpdateTime|Document::recalcStyle|Document::updateStyle|UpdateLayoutTree|RecalcStyle|StyleRecalc)/],
  ['layout', /^(Blink.Layout.UpdateTime|LocalFrameView::performLayout|LocalFrameView::performPostLayoutTasks|Layout$|UpdateLayout|DisplayLock)/],
  ['prepaint', /^(Blink.PrePaint.UpdateTime|PrePaint|PaintInvalidator|CullRectUpdate|Blink.CompositingInputs.UpdateTime)/],
  ['paint', /^(Blink.Paint.UpdateTime|LocalFrameView::RunPaintLifecyclePhase|Paint$|PaintImage|Decode)/],
  ['layerize', /^(PaintArtifactCompositor|Layerize|Blink.CompositingCommit|LayerTreeHost::UpdateLayers)/],
  ['commit', /^(Commit|ProxyMain::BeginMainFrame::commit|LayerTreeHost::DoUpdateLayers|LayerTreeHost::WaitForCommitCompletion|ThreadProxy|ProxyImpl)/],
]
const stageOf = (name) => STAGES.find(([, pattern]) => pattern.test(name))?.[0]

// Self time of every event, nested by time on the one thread.
const selfTimes = (list) => {
  const spans = []
  const stack = []
  for (const e of list) {
    while (stack.length > 0 && stack.at(-1).end <= e.ts) stack.pop()
    const parent = stack.at(-1)
    const span = { start: e.ts, end: e.ts + e.dur, name: e.name, self: e.dur, args: e.args, stage: stageOf(e.name) ?? parent?.stage ?? 'other' }
    if (parent !== undefined) parent.self -= Math.min(e.dur, parent.end - e.ts)
    stack.push(span)
    spans.push(span)
  }
  return spans
}
const spans = selfTimes(own)

// Other threads' busy time: top-level spans only.
const busy = (k) => {
  const list = complete(k)
  const top = []
  let reach = -Infinity
  for (const e of list) if (e.ts >= reach) { top.push(e); reach = e.ts + e.dur }
  return top
}
const side = new Map()
for (const [k, name] of threads) {
  const pid = Number(k.split(':')[0])
  const label =
    pid === rendererPid && name === 'Compositor' ? 'compositor' :
    pid === rendererPid && name.startsWith('CompositorTileWorker') ? 'raster' :
    name === 'VizCompositorThread' ? 'viz' :
    name === 'CrGpuMain' ? 'gpu' : undefined
  if (label !== undefined) side.set(label, [...(side.get(label) ?? []), ...busy(k)])
}

const frames = []
let next = 0
let spanAt = 0
for (let i = 0; i + 1 < frameStarts.length; i++) {
  const from = frameStarts[i]
  const to = frameStarts[i + 1]
  if (from < start || to > end) continue
  while (next < tasks.length && tasks[next].ts < from) next++
  let work = 0
  let lastTask = from
  for (let k = next; k < tasks.length && tasks[k].ts < to; k++) { work += tasks[k].dur; lastTask = tasks[k].ts + tasks[k].dur }
  const stages = new Map()
  const names = new Map()
  while (spanAt < spans.length && spans[spanAt].start < from) spanAt++
  let dirty = 0
  let styled = 0
  for (let k = spanAt; k < spans.length && spans[k].start < to; k++) {
    const s = spans[k]
    if (s.name === 'Layout') dirty += s.args?.beginData?.dirtyObjects ?? 0
    if (s.name === 'UpdateLayoutTree') styled += s.args?.elementCount ?? 0
    if (s.self <= 0 || s.name === 'RunTask' || s.start >= lastTask) continue
    stages.set(s.stage, (stages.get(s.stage) ?? 0) + s.self)
    names.set(`${s.stage}\t${s.name}`, (names.get(`${s.stage}\t${s.name}`) ?? 0) + s.self)
  }
  // RunTask's own self time: scheduler and IPC overhead outside any named event.
  const named = [...stages.values()].reduce((a, b) => a + b, 0)
  stages.set('other', (stages.get('other') ?? 0) + Math.max(0, work - named))
  const sideBusy = new Map()
  for (const [label, list] of side) sideBusy.set(label, list.reduce((n, e) => n + Math.max(0, Math.min(e.ts + e.dur, to) - Math.max(e.ts, from)), 0))
  frames.push({ from, work: work / 1000, stages, names, dirty, styled, sideBusy, interval: (to - from) / 1000 })
}

const ms = (us) => (us / 1000).toFixed(2)
const percentile = (values, q) => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0
const order = ['script', 'gc', 'observers', 'input', 'scroll', 'caret', 'style', 'layout', 'prepaint', 'paint', 'layerize', 'commit', 'other']
const mean = (list, pick) => list.length === 0 ? 0 : list.reduce((n, f) => n + pick(f), 0) / list.length

const heavy = frames.filter((f) => f.work > BUDGET)
const works = frames.map((f) => f.work)
console.log(`${file.split('/').pop()}: ${frames.length} frames, work p50 ${percentile(works, 0.5).toFixed(2)} p95 ${percentile(works, 0.95).toFixed(2)} max ${Math.max(...works).toFixed(2)} ms, ${heavy.length} over ${BUDGET} ms`)
console.log(`  mean ms per frame by stage     all frames   frames > ${BUDGET}`)
for (const stage of order) console.log(`    ${stage.padEnd(28)}${ms(mean(frames, (f) => f.stages.get(stage) ?? 0)).padStart(10)}${ms(mean(heavy, (f) => f.stages.get(stage) ?? 0)).padStart(14)}`)
console.log(`    ${'total'.padEnd(28)}${mean(frames, (f) => f.work).toFixed(2).padStart(10)}${mean(heavy, (f) => f.work).toFixed(2).padStart(14)}`)
console.log('  mean ms per frame on other threads (not in the gate)')
for (const label of ['compositor', 'raster', 'viz', 'gpu']) if (side.has(label)) console.log(`    ${label.padEnd(28)}${ms(mean(frames, (f) => f.sideBusy.get(label) ?? 0)).padStart(10)}${ms(mean(heavy, (f) => f.sideBusy.get(label) ?? 0)).padStart(14)}`)

const totals = new Map()
for (const f of heavy) for (const [name, us] of f.names) totals.set(name, (totals.get(name) ?? 0) + us)
console.log(`  events by self time in frames > ${BUDGET}, mean ms per heavy frame`)
for (const [name, us] of [...totals].toSorted((a, b) => b[1] - a[1]).slice(0, option('top', 20))) console.log(`    ${ms(us / Math.max(1, heavy.length)).padStart(7)}  ${name.split('\t')[0].padEnd(10)} ${name.split('\t')[1]}`)

console.log('  heaviest frames')
for (const f of frames.toSorted((a, b) => b.work - a.work).slice(0, option('frames', 10))) {
  const parts = order.filter((s) => (f.stages.get(s) ?? 0) > 200).map((s) => `${s} ${ms(f.stages.get(s))}`).join(', ')
  console.log(`    ${f.work.toFixed(1).padStart(6)} ms at ${((f.from - start) / 1000).toFixed(0).padStart(6)} ms, next frame +${f.interval.toFixed(1)}: ${parts}; dirty ${f.dirty}, styled ${f.styled}`)
}

if (args.includes('--sequence')) {
  console.log('  frame sequence')
  const at = option('sequence', 0)
  for (const f of frames.slice(at, at + 40)) {
    const parts = order.filter((s) => (f.stages.get(s) ?? 0) > 100).map((s) => `${s} ${ms(f.stages.get(s))}`).join(', ')
    console.log(`    ${((f.from - start) / 1000).toFixed(0).padStart(6)} ms ${f.work.toFixed(1).padStart(5)}: ${parts}; dirty ${f.dirty}, styled ${f.styled}`)
  }
}
