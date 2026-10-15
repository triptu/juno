import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

/** Main-thread work per frame, in milliseconds: what the scroll budget is about. */
export interface FrameWork {
  readonly work: ReadonlyArray<number>
  readonly layouts: ReadonlyArray<number>
  readonly styled: ReadonlyArray<number>
}

const TRACE_DIR = process.env['JUNO_PERF_TRACE']

/**
 * Records a Chrome trace of the renderer while `run` runs and answers with
 * the main thread's work per frame: every task from the start of one
 * frame's task to the next. With JUNO_PERF_TRACE set to a directory it
 * records every category and a CPU profile too, and writes them as
 * `<name>.trace.json` and `<name>.cpuprofile` for scripts/perf-trace.mjs.
 */
export async function traced(win: Page, name: string, run: () => Promise<void>): Promise<FrameWork> {
  return frameWork(await recordTrace(win, name, run))
}

/** Records frame and input timestamps on Chromium's shared trace clock. */
export async function recordTrace(win: Page, name: string, run: () => Promise<void>): Promise<string> {
  const cdp = await win.context().newCDPSession(win)
  const categories =
    TRACE_DIR === undefined
      ? ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'benchmark']
      : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing', 'v8.execute', 'blink', 'cc', 'benchmark', 'gpu', 'viz']
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: categories }, transferMode: 'ReturnAsStream' })
  let trace = ''
  let layers: Array<{ layerId: string; backendNodeId?: number; width: number; height: number; drawsContent: boolean }> = []
  if (TRACE_DIR !== undefined) {
    cdp.on('LayerTree.layerTreeDidChange', (event) => { layers = event.layers ?? [] })
    await cdp.send('LayerTree.enable')
  }
  if (TRACE_DIR !== undefined) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.start')
  }
  // Starting a trace stops the renderer for a garbage collection: a 50-60 ms frame that is not the scenario's.
  await win.waitForTimeout(500)
  try {
    await win.evaluate(() => performance.mark('perf.sample.start'))
    await run()
    await win.evaluate(() => performance.mark('perf.sample.end'))
  } finally {
    const profile = TRACE_DIR === undefined ? undefined : (await cdp.send('Profiler.stop')).profile
    const done = new Promise<string>((resolve) => cdp.once('Tracing.tracingComplete', (event) => resolve(event.stream!)))
    await cdp.send('Tracing.end')
    const handle = await done
    const chunks: string[] = []
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle })
      chunks.push(chunk.base64Encoded === true ? Buffer.from(chunk.data, 'base64').toString() : chunk.data)
      if (chunk.eof) break
    }
    await cdp.send('IO.close', { handle })
    if (TRACE_DIR !== undefined) {
      const reasons = await Promise.all(layers.map(async (layer) => ({ ...layer, reasons: await cdp.send('LayerTree.compositingReasons', { layerId: layer.layerId }).catch(() => undefined) })))
      await mkdir(TRACE_DIR, { recursive: true })
      await writeFile(join(TRACE_DIR, `${name}.layers.json`), JSON.stringify(reasons))
    }
    await cdp.detach()
    trace = chunks.join('')
    if (TRACE_DIR !== undefined) {
      await mkdir(TRACE_DIR, { recursive: true })
      await writeFile(join(TRACE_DIR, `${name}.trace.json`), trace)
      await writeFile(join(TRACE_DIR, `${name}.cpuprofile`), JSON.stringify(profile))
    }
  }
  return trace
}

interface TraceEvent {
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
  readonly dur?: number
  readonly args?: { readonly name?: string; readonly beginData?: { readonly dirtyObjects?: number }; readonly elementCount?: number }
}

/** Sums the renderer main thread's top-level tasks between the starts of consecutive frame tasks. */
export function frameWork(json: string): FrameWork {
  const parsed = JSON.parse(json) as { readonly traceEvents: ReadonlyArray<TraceEvent> } | ReadonlyArray<TraceEvent>
  const events = 'traceEvents' in parsed ? parsed.traceEvents : parsed
  const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`))
  const frameCounts = new Map<string, number>()
  for (const e of events) if (e.ph === 'X' && e.name === 'ProxyMain::BeginMainFrame' && mains.has(`${e.pid}:${e.tid}`)) frameCounts.set(`${e.pid}:${e.tid}`, (frameCounts.get(`${e.pid}:${e.tid}`) ?? 0) + 1)
  // The window's renderer is the one drawing frames.
  const main = [...frameCounts].toSorted((a, b) => b[1] - a[1])[0]?.[0]
  if (main === undefined) throw new Error('Trace contains no renderer frames')
  const on = (e: TraceEvent) => `${e.pid}:${e.tid}` === main && e.ph === 'X'
  const tasks = events.filter((e) => on(e) && e.name === 'RunTask').toSorted((a, b) => a.ts - b.ts)
  const frameStarts = events
    .filter((e) => on(e) && e.name === 'ProxyMain::BeginMainFrame')
    .map((frame) => tasks.find((task) => task.ts <= frame.ts && frame.ts < task.ts + (task.dur ?? 0))?.ts ?? frame.ts)
    .toSorted((a, b) => a - b)
  const start = events.find((e) => e.name === 'perf.sample.start')?.ts
  const end = events.find((e) => e.name === 'perf.sample.end')?.ts
  if (start === undefined || end === undefined || end <= start) throw new Error('Trace is missing its measurement bounds')
  const rendering = events.filter((e) => on(e) && (e.name === 'Layout' || e.name === 'UpdateLayoutTree'))
  const work: number[] = []
  const layouts: number[] = []
  const styled: number[] = []
  let next = 0
  for (let i = 0; i + 1 < frameStarts.length; i++) {
    if (frameStarts[i]! < start || frameStarts[i + 1]! > end) continue
    while (next < tasks.length && tasks[next]!.ts < frameStarts[i]!) next++
    let sum = 0
    for (let k = next; k < tasks.length && tasks[k]!.ts < frameStarts[i + 1]!; k++) sum += tasks[k]!.dur ?? 0
    work.push(sum / 1000)
    const inFrame = rendering.filter((e) => e.ts >= frameStarts[i]! && e.ts < frameStarts[i + 1]!)
    layouts.push(inFrame.reduce((n, e) => n + (e.args?.beginData?.dirtyObjects ?? 0), 0))
    styled.push(inFrame.reduce((n, e) => n + (e.args?.elementCount ?? 0), 0))
  }
  return { work, layouts, styled }
}

