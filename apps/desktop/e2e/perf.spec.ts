// Juno's numbers against docs/performance.md section 1, measured on the
// built app. Not part of `test:e2e`: the numbers depend on the machine, so
// the scenarios run on their own through the heavy-job lock. Each one prints
// its samples and the load average and fails when a p95 (or a p50 where the
// budget says so) is over its budget.
//
//   pnpm perf                  every scenario
//   pnpm perf -g "topic view"  some of them
//   JUNO_PERF_TRACE=<dir>      also write traces and CPU profiles (scripts/perf-trace.mjs)
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { largeSeed, startFakeSlack, topic300Seed, TOPIC300_MAIN_CHANNEL, TOPIC300_THREAD_CHANNEL, type FakeSlack } from '@juno/fake-slack'
import { expect, launchApp, tempUserData, test, writeSlackApp, type RunningApp, type SlackAppFixture } from './fixtures'
import { Juno, press, type SidebarFilterName } from './driver/juno'

test.skip(process.env['JUNO_PERF'] !== '1', 'set JUNO_PERF=1 to measure')

const POSTGRES = 'Draft plan is in the doc'

function stats(name: string, samples: ReadonlyArray<number>): { readonly median: number; readonly p95: number } {
  const sorted = samples.toSorted((a, b) => a - b)
  // Nearest rank: the p95 of 20 samples is the 19th, not the largest.
  const at = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0
  const median = at(0.5)
  const p95 = at(0.95)
  const load = loadavg()[0]!.toFixed(1)
  const shown = sorted.length <= 60 ? `, samples ${sorted.map((s) => s.toFixed(1)).join(' ')}` : ''
  console.log(`${name}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, n=${samples.length}, load ${load}${shown}`)
  return { median, p95 }
}

/** Fails the scenario when `value` is over its budget from docs/performance.md section 1. */
function within(name: string, value: number, budget: number): void {
  expect(value, `${name}: ${value.toFixed(1)} ms against a budget of ${budget.toFixed(1)} ms`).toBeLessThanOrEqual(budget)
}

/** The display's refresh interval: the median of 30 animation frame intervals. */
async function refreshInterval(win: Page): Promise<number> {
  return win.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = []
        const tick = (now: number) => {
          times.push(now)
          if (times.length <= 30) requestAnimationFrame(tick)
          else resolve(times.slice(1).map((t, i) => t - times[i]!).toSorted((a, b) => a - b)[15]!)
        }
        requestAnimationFrame(tick)
      }),
  )
}

/**
 * The budget for "one frame" interactions (tab switch, prefetched open,
 * hover): 16 ms on the 120 Hz reference display. Measured from the input
 * to the frame presented, it includes the wait for the next refresh, which
 * at 60 Hz alone reaches 16.4 ms at p95 with no work at all (the frame
 * floor scenario). On a slower display it is one refresh interval plus the
 * 8 ms of work a 120 Hz frame allows, as proposed in performance.md 8.
 */
function oneFrameBudget(interval: number): number {
  return interval < 10 ? 16 : interval + 8
}

/**
 * Counts the times the window is hidden from now on. macOS hides a window
 * that another window covers, and a hidden window draws no frames, so every
 * measure that ends after a paint waits until it shows again.
 */
async function countHidden(win: Page): Promise<() => Promise<number>> {
  await win.evaluate(() => {
    const w = window as unknown as { __hidden: number }
    w.__hidden = document.visibilityState === 'hidden' ? 1 : 0
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') w.__hidden++
    })
  })
  return () => win.evaluate(() => (window as unknown as { __hidden: number }).__hidden)
}

/** Main-thread work per frame, in milliseconds: what the scroll budget is about. */
interface FrameWork {
  readonly work: ReadonlyArray<number>
}

const TRACE_DIR = process.env['JUNO_PERF_TRACE']

/**
 * Records a Chrome trace of the renderer while `run` runs and answers with
 * the main thread's work per frame: every task from the start of one
 * frame's task to the next. With JUNO_PERF_TRACE set to a directory it
 * records every category and a CPU profile too, and writes them as
 * `<name>.trace.json` and `<name>.cpuprofile` for scripts/perf-trace.mjs.
 */
async function traced(win: Page, name: string, run: () => Promise<void>): Promise<FrameWork> {
  const cdp = await win.context().newCDPSession(win)
  const categories =
    TRACE_DIR === undefined
      ? ['disabled-by-default-devtools.timeline', 'benchmark']
      : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing', 'v8.execute', 'blink', 'cc', 'benchmark', 'gpu', 'viz']
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: categories }, transferMode: 'ReturnAsStream' })
  let trace = ''
  if (TRACE_DIR !== undefined) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.start')
  }
  // Starting a trace stops the renderer for a garbage collection: a 50-60 ms frame that is not the scenario's.
  await win.waitForTimeout(500)
  try {
    await run()
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
    await cdp.detach()
    trace = chunks.join('')
    if (TRACE_DIR !== undefined) {
      await mkdir(TRACE_DIR, { recursive: true })
      await writeFile(join(TRACE_DIR, `${name}.trace.json`), trace)
      await writeFile(join(TRACE_DIR, `${name}.cpuprofile`), JSON.stringify(profile))
    }
  }
  return { work: frameWork(trace) }
}

interface TraceEvent {
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
  readonly dur?: number
  readonly args?: { readonly name?: string }
}

/** Sums the renderer main thread's top-level tasks between the starts of consecutive frame tasks. */
function frameWork(json: string): number[] {
  const parsed = JSON.parse(json) as { readonly traceEvents: ReadonlyArray<TraceEvent> } | ReadonlyArray<TraceEvent>
  const events = 'traceEvents' in parsed ? parsed.traceEvents : parsed
  const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`))
  const frameCounts = new Map<string, number>()
  for (const e of events) if (e.ph === 'X' && e.name === 'ProxyMain::BeginMainFrame' && mains.has(`${e.pid}:${e.tid}`)) frameCounts.set(`${e.pid}:${e.tid}`, (frameCounts.get(`${e.pid}:${e.tid}`) ?? 0) + 1)
  // The window's renderer is the one drawing frames.
  const main = [...frameCounts].toSorted((a, b) => b[1] - a[1])[0]?.[0]
  const on = (e: TraceEvent) => `${e.pid}:${e.tid}` === main && e.ph === 'X'
  const tasks = events.filter((e) => on(e) && e.name === 'RunTask').toSorted((a, b) => a.ts - b.ts)
  const frameStarts = events
    .filter((e) => on(e) && e.name === 'ProxyMain::BeginMainFrame')
    .map((frame) => tasks.find((task) => task.ts <= frame.ts && frame.ts < task.ts + (task.dur ?? 0))?.ts ?? frame.ts)
    .toSorted((a, b) => a - b)
  const work: number[] = []
  let next = 0
  for (let i = 0; i + 1 < frameStarts.length; i++) {
    while (next < tasks.length && tasks[next]!.ts < frameStarts[i]!) next++
    let sum = 0
    for (let k = next; k < tasks.length && tasks[k]!.ts < frameStarts[i + 1]!; k++) sum += tasks[k]!.dur ?? 0
    work.push(sum / 1000)
  }
  return work
}

// The floor under every input-to-paint measure: a pointerdown that does no
// work, to the first moment after the next presented frame, timed the way
// `afterPaint` times the app's measures. On a 60 Hz display it spreads over
// one 16.7 ms frame however fast the app is.
test('frame floor: input with no work to the next frame', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await win.evaluate(() => {
    const w = window as unknown as { __floor: number[] }
    w.__floor = []
    window.addEventListener('pointerdown', () => {
      const start = performance.now()
      requestAnimationFrame(() => setTimeout(() => w.__floor.push(performance.now() - start), 0))
    })
  })
  for (let i = 0; i < 30; i++) {
    await win.mouse.move(900, 300 + i)
    await press(win)
    await win.waitForTimeout(37 + (i % 7) * 3)
  }
  stats('frame floor, pointerdown with no work to next frame presented', await win.evaluate(() => (window as unknown as { __floor: number[] }).__floor))
})

test('row hover to paint', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const rows = juno.sidebar.rows
  const count = Math.min(await rows.count(), 9)
  const samples: number[] = []
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    await row.scrollIntoViewIfNeeded()
    const box = (await row.boundingBox())!
    await win.mouse.move(900, 400)
    await win.waitForTimeout(100)
    // The row records the pointerover and the first moment after the next presented frame.
    await row.evaluate((node) => {
      const w = window as unknown as { __hoverSample?: Promise<number> }
      w.__hoverSample = new Promise((resolve) => {
        node.addEventListener(
          'pointerover',
          (event) => {
            const start = event.timeStamp
            requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - start), 0))
          },
          { once: true },
        )
      })
    })
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    samples.push(await win.evaluate(() => (window as unknown as { __hoverSample: Promise<number> }).__hoverSample))
  }
  const hover = stats('row hover (pointerover event) to next frame presented', samples)
  within('row hover, p95', hover.p95, oneFrameBudget(await refreshInterval(win)))
})

// Home from the sidebar's Home item, with a topic open in the tab: the
// pointerdown to the first presented frame that shows Home's greeting and
// rows, read from the local cache (performance.md section 1, "Home open").
// Every fourth sample comes back after the home.view subscription's idle
// time, so both a warm and a cold query are in the numbers.
test('home open: from a topic to Home painted', async ({ juno, win }) => {
  test.setTimeout(360_000)
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar, topic } = juno
  await home.open()
  await expect(home.item('waiting')).toBeVisible()
  // The engine's time for each home.view run, from its juno.live-update measures.
  await win.evaluate(() => {
    const w = window as unknown as { __homeQuery: number[] }
    w.__homeQuery = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { detail?: { devtools?: { properties?: ReadonlyArray<readonly [string, unknown]> } } }>) {
        const properties = new Map(entry.detail?.devtools?.properties ?? [])
        if (entry.name === 'juno.live-update' && properties.get('route') === 'home.view') w.__homeQuery.push(Number(properties.get('queryMs')))
      }
    }).observe({ type: 'measure' })
  })
  const samples: number[] = []
  const cold: string[] = []
  for (let i = 0; i < 20; i++) {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await win.waitForTimeout(i % 4 === 3 ? 31_000 : 300)
    const nav = home.navItem
    const queries = await win.evaluate(() => (window as unknown as { __homeQuery: number[] }).__homeQuery.length)
    await nav.evaluate((node) => {
      const w = window as unknown as { __homeSample?: Promise<number> }
      w.__homeSample = new Promise((resolve) => {
        node.addEventListener(
          'pointerdown',
          (event) => {
            const start = event.timeStamp
            const shown = () => document.querySelector('[data-home]:not([data-home-waiting]) [data-home-item]') !== null
            const frame = () => requestAnimationFrame(() => (shown() ? setTimeout(() => resolve(performance.now() - start), 0) : frame()))
            frame()
          },
          { once: true },
        )
      })
    })
    // `press`, not `click`: a pointerup in the next frame defers the end of the measure by a frame (performance.md 7.1).
    const box = (await nav.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await press(win)
    samples.push(await win.evaluate(() => (window as unknown as { __homeSample: Promise<number> }).__homeSample))
    if (i % 4 === 3) {
      await win.waitForTimeout(100)
      const query = await win.evaluate((from) => (window as unknown as { __homeQuery: number[] }).__homeQuery.slice(from), queries)
      cold.push(`${samples.at(-1)!.toFixed(1)} ms (home.view ${query.map((ms) => ms.toFixed(1)).join(', ') || 'no run'})`)
    }
  }
  console.log(`home open after the subscription's idle time: ${cold.join('; ')}`)
  const open = stats('home open (pointerdown on Home) to Home painted', samples)
  within('home open, p95', open.p95, 50)
})

test('live update: a reply from another client to pixels', async ({ juno, fake }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  const postgres = juno.sidebar.row(POSTGRES)
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(POSTGRES))!
  const measured: number[] = []
  const wall: number[] = []
  for (let i = 0; i < 9; i++) {
    const text = `Perf sample ${i} ${Date.now()}`
    const at = Date.now()
    fake.injectMessage({ channel: 'C0ENG', threadTs: root.ts, user: 'U0LEO', text })
    await postgres.expectPreview(`Leo: ${text}`)
    wall.push(Date.now() - at)
    measured.push((await juno.measure('juno.live-update'))!)
    await juno.win.waitForTimeout(300)
  }
  // The engine stamps the commit; the renderer ends the measure after the paint.
  const live = stats('live update, engine commit to pixels (juno.live-update)', measured)
  within('live update, p95', live.p95, 50)
  // Includes the fake's socket frame, the engine's merge, and Playwright's own polling.
  stats('live update, inject call to new preview seen by Playwright', wall)
})

test('send: Enter to the pending row painted', async ({ juno }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const hidden = await countHidden(juno.win)
  const measured: number[] = []
  for (let i = 0; i < 9; i++) {
    const text = `Perf send ${i} ${Date.now()}`
    const before = (await juno.measures('juno.send')).length
    await juno.topic.send(text)
    await juno.topic.expectSent(text)
    // The measure ends after the frame is presented, which can be after the row settles.
    await expect.poll(async () => (await juno.measures('juno.send')).length, { timeout: 15_000 }).toBeGreaterThan(before)
    measured.push((await juno.measures('juno.send')).at(-1)!)
    await juno.win.waitForTimeout(300)
  }
  expect(await hidden(), 'the window was hidden or covered while measuring, so its frames were not drawn').toBe(0)
  // A local transaction, the delta and the paint; the Slack call is not part of it.
  const send = stats('send, Enter to the pending row painted (juno.send)', measured)
  within('send, p95', send.p95, 50)
})

// The large-workspace scenarios share one synced user-data directory: the
// fake's 1,200-topic seed fills the 300-row window, and syncing it once
// keeps the run short. Every scenario launches the app warm on it.
//
// The groups here are not serial: a serial group skips every scenario after
// one that fails, so a budget missed early would leave the rest unmeasured.
// With one worker they still run in order on one setup; after a failure the
// next worker runs the setup again and goes on.
test.describe('large workspace', () => {
  let fake: FakeSlack
  let userData: string
  let slackDir: string
  let slackApp: SlackAppFixture

  const launch = (): Promise<RunningApp> => launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })

  test.beforeAll(async () => {
    test.setTimeout(900_000)
    fake = await startFakeSlack({ seed: largeSeed({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }) })
    userData = await tempUserData()
    slackDir = await tempUserData()
    slackApp = await writeSlackApp(fake, slackDir)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      await juno.signIn()
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(600_000)
    } finally {
      await running.close()
    }
  })

  test.afterAll(async () => {
    await fake?.close()
    await rm(userData, { recursive: true, force: true })
    await rm(slackDir, { recursive: true, force: true })
  })

  test('warm start: main process to shell and rows, snapshot to rows, the longest frame', async () => {
    test.setTimeout(300_000)
    const runs: Array<Awaited<ReturnType<Juno['startupTimes']>>> = []
    // The first launch warms the OS and V8 caches and is not counted.
    for (let i = 0; i < 6; i++) {
      const running = await launch()
      try {
        const juno = new Juno(running.app, running.win)
        await juno.sidebar.expectRows()
        const times = await juno.startupTimes()
        if (i > 0) runs.push(times)
        // Where the start goes: main to the renderer's navigation, the bundle loaded and run (`juno.start` is
        // marked after every import), then the shell and the rows. Times after `+` are from the navigation.
        const [created, renderer] = await running.app.evaluate(({ app }) => {
          const metrics = app.getAppMetrics()
          return [metrics.find((metric) => metric.type === 'Browser')?.creationTime ?? 0, metrics.find((metric) => metric.type === 'Tab')?.creationTime ?? Number.NaN] as const
        })
        const page = await running.win.evaluate(() => ({ origin: performance.timeOrigin, start: performance.getEntriesByName('juno.start', 'mark')[0]?.startTime ?? Number.NaN }))
        if (i > 0) console.log(`warm start ${i}: main to renderer process ${(renderer - created).toFixed(0)} ms, to navigation ${(page.origin - created).toFixed(0)} ms, bundle run at +${page.start.toFixed(0)}, shell at +${(created + times.mainToShell - page.origin).toFixed(0)}, rows at +${(created + times.mainToRows - page.origin).toFixed(0)}`)
      } finally {
        await running.close()
      }
    }
    console.log(`rows in the window: ${runs.map((run) => run.rows).join(' ')}`)
    stats('warm start, main process created to shell painted', runs.map((run) => run.mainToShell))
    const rows = stats('warm start, main process created to sidebar rows painted', runs.map((run) => run.mainToRows))
    within('warm start to sidebar rows, median', rows.median, 500)
    stats('warm start, sidebar snapshot to rows painted (juno.sidebar-paint)', runs.map((run) => run.snapshotToRows))
    stats('warm start, longest animation frame up to 1 s after the rows', runs.map((run) => run.longestFrame))
    stats('warm start, blocking time of that frame', runs.map((run) => run.longestBlocking))
    console.log(`long animation frames up to 1 s after the rows: ${runs.map((run) => run.longFrames).join(' ')}`)
  })

  test('filter change: never an empty frame, and the time to the new list', async () => {
    test.setTimeout(300_000)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { sidebar } = juno
      await sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      await running.win.mouse.move(900, 400)
      // The other filters' subscriptions are warmed on idle after the first paint.
      await running.win.waitForTimeout(1_000)

      const stop = await sidebar.watchFrames()
      const order: ReadonlyArray<SidebarFilterName> = ['Channels', 'DMs', 'All']
      for (let round = 0; round < 5; round++) {
        for (const name of order) {
          const before = (await juno.measures('juno.filter')).length
          await sidebar.filter(name)
          await expect.poll(async () => (await juno.measures('juno.filter')).length).toBe(before + 1)
          await running.win.waitForTimeout(250)
        }
      }
      const frames = await stop()
      const durations = await juno.measures('juno.filter')
      console.log(`filter frames: ${frames.frames}, with no rows: ${frames.blank}, fewest rows in a frame: ${frames.fewest}`)
      const filter = stats('filter change, press to new list painted (juno.filter)', durations)
      expect(frames.blank).toBe(0)
      within('filter change, p95', filter.p95, 50)
    } finally {
      await running.close()
    }
  })

  test('scroll frame times, and memory after scrolling', async () => {
    test.setTimeout(300_000)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { win } = running
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      const rows = await juno.sidebar.rows.count()
      console.log(`rows in the window: ${rows}`)

      const list = juno.sidebar.list
      const box = (await list.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      // Long animation frames with their scripts, so a slow frame can be explained.
      await win.evaluate(() => {
        const w = window as unknown as { __loaf: string[] }
        w.__loaf = []
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            const detail = entry as PerformanceEntry & { blockingDuration?: number; scripts?: ReadonlyArray<{ duration: number; invoker: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number }> }
            const scripts = (detail.scripts ?? []).map((script) => `${script.invoker} ${script.sourceFunctionName || '?'}@${script.sourceURL.split('/').pop()}:${script.sourceCharPosition} ${script.duration.toFixed(0)}ms`)
            w.__loaf.push(`+${Math.round(entry.startTime)}ms ${entry.duration.toFixed(0)}ms blocking ${(detail.blockingDuration ?? 0).toFixed(0)}ms [${scripts.join('; ')}]`)
          }
        }).observe({ type: 'long-animation-frame', buffered: false })
      })
      const interval = await refreshInterval(win)
      const sweep = async (label: string) => {
        let frames: number[] = []
        let loaf: string[] = []
        // About 2 000 px/s for 3 s, down then up.
        const { work } = await traced(win, `scroll-sidebar-${label.replace(' ', '-')}`, async () => {
          await win.evaluate(() => {
            const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: string[] }
            w.__frames = []
            w.__loaf = []
            w.__sampling = true
            let last = performance.now()
            const tick = (now: number) => {
              w.__frames.push(now - last)
              last = now
              if (w.__sampling) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          for (let i = 0; i < 30; i++) {
            await win.mouse.wheel(0, 200)
            await win.waitForTimeout(100)
          }
          for (let i = 0; i < 30; i++) {
            await win.mouse.wheel(0, -200)
            await win.waitForTimeout(100)
          }
          // Read before the trace ends: collecting it stalls the renderer too.
          ;({ frames, loaf } = await win.evaluate(() => {
            const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: string[] }
            w.__sampling = false
            return { frames: w.__frames.slice(1), loaf: w.__loaf }
          }))
        })
        const sorted = frames.toSorted((a, b) => a - b)
        const p95 = sorted[Math.floor(0.95 * sorted.length)] ?? 0
        const max = sorted[sorted.length - 1] ?? 0
        const over = frames.filter((f) => f > interval * 1.5).length
        console.log(`scroll ${label}: ${frames.length} frames, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, frames over 1.5 intervals ${over}, long animation frames ${loaf.length}, load ${loadavg()[0]!.toFixed(1)}`)
        for (const line of loaf) console.log(`  loaf ${line}`)
        const perFrame = stats(`scroll sidebar ${label}, main-thread work per frame`, work)
        within(`scroll sidebar ${label}, main-thread work per frame, p95`, perFrame.p95, 8.3)
        expect(loaf).toEqual([])
        expect(over / frames.length).toBeLessThan(0.01)
      }
      // The first pass lays out rows the window has never shown; the second is the steady state.
      const warmed = await juno.lastMark('juno.prefetch')
      await sweep('first pass')
      await win.waitForTimeout(1000)
      await sweep('second pass')
      // Rows that scroll under the still pointer are not warmed (performance.md 3.2).
      expect(await juno.lastMark('juno.prefetch')).toBe(warmed)
      console.log(`scrollTop after the run: ${await list.evaluate((node) => node.scrollTop)}`)

      // Memory per process (working set, MB) and the renderer's JS heap and DOM size.
      const metrics = await running.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({ type: metric.type, name: metric.serviceName ?? metric.name ?? '', mb: metric.memory.workingSetSize / 1024 })))
      for (const metric of metrics) console.log(`memory ${metric.type}${metric.name ? ` ${metric.name}` : ''}: ${metric.mb.toFixed(0)} MB working set`)
      const page = await win.evaluate(() => ({ heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0, nodes: document.getElementsByTagName('*').length }))
      console.log(`renderer JS heap ${(page.heap / 1024 / 1024).toFixed(1)} MB, ${page.nodes} DOM elements`)
    } finally {
      await running.close()
    }
  })

  test('All topics: open, then scroll the whole list, moving its window', async () => {
    test.setTimeout(300_000)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { win } = running
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      // The page's chunk loads on idle after the first paint, as it does for a person.
      await win.waitForTimeout(1_000)

      // Open: mouse down on the nav item to the page painted with rows. Each round closes the tab, so every open mounts the page afresh.
      const nav = juno.allTopics.navItem
      const box = (await nav.boundingBox())!
      for (let i = 0; i < 12; i++) {
        const before = (await juno.measures('juno.all-topics-open')).length
        await win.mouse.move(box.x + 40, box.y + box.height / 2)
        await press(win)
        await expect.poll(async () => (await juno.measures('juno.all-topics-open')).length).toBe(before + 1)
        await juno.tabs.close('All topics')
        await expect(juno.allTopics.table).toHaveCount(0)
      }
      const opens = (await juno.measures('juno.all-topics-open')).slice(2)
      const open = stats('All topics open, press to rows painted (juno.all-topics-open)', opens)
      within('All topics open, p95', open.p95, 50)

      await juno.allTopics.open()
      const table = juno.allTopics.table
      const total = Number(await table.getAttribute('aria-rowcount')) - 1
      console.log(`All topics rows: ${total}`)
      const tableBox = (await table.boundingBox())!
      await win.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2)
      await win.evaluate(() => {
        const w = window as unknown as { __loaf: string[] }
        w.__loaf = []
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) w.__loaf.push(`+${Math.round(entry.startTime)}ms ${entry.duration.toFixed(0)}ms`)
        }).observe({ type: 'long-animation-frame', buffered: false })
      })
      const interval = await refreshInterval(win)
      const sweep = async (label: string) => {
        let frames: number[] = []
        let loaf: string[] = []
        let placeholders = 0
        // About 2 000 px/s for 8 s down and back: about 300 rows each way, so the 200-row window moves on the way down and again on the way up.
        const { work } = await traced(win, `scroll-all-topics-${label.replace(' ', '-')}`, async () => {
          await win.evaluate(() => {
            const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: string[]; __placeholders: number }
            w.__frames = []
            w.__loaf = []
            w.__placeholders = 0
            w.__sampling = true
            let last = performance.now()
            const grid = document.querySelector('[data-all-topics-table]')!
            const tick = (now: number) => {
              w.__frames.push(now - last)
              last = now
              // Rows on screen still waiting for their window.
              const view = grid.getBoundingClientRect()
              for (const row of grid.querySelectorAll('[aria-busy="true"]')) {
                const rect = row.getBoundingClientRect()
                if (rect.bottom > view.top && rect.top < view.bottom) w.__placeholders++
              }
              if (w.__sampling) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          for (let i = 0; i < 80; i++) {
            await win.mouse.wheel(0, 200)
            await win.waitForTimeout(100)
          }
          const offset = await win.evaluate(() => document.querySelector('[data-all-topics-row]')?.getAttribute('aria-rowindex'))
          console.log(`first row drawn at the bottom of the sweep: ${offset}`)
          for (let i = 0; i < 80; i++) {
            await win.mouse.wheel(0, -200)
            await win.waitForTimeout(100)
          }
          ;({ frames, loaf, placeholders } = await win.evaluate(() => {
            const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: string[]; __placeholders: number }
            w.__sampling = false
            return { frames: w.__frames.slice(1), loaf: w.__loaf, placeholders: w.__placeholders }
          }))
        })
        const sorted = frames.toSorted((a, b) => a - b)
        const over = frames.filter((f) => f > interval * 1.5).length
        console.log(`scroll All topics ${label}: ${frames.length} frames, p95 ${(sorted[Math.floor(0.95 * sorted.length)] ?? 0).toFixed(1)} ms, frames over 1.5 intervals ${over}, long animation frames ${loaf.length}, placeholder rows on screen summed over frames ${placeholders}, load ${loadavg()[0]!.toFixed(1)}`)
        for (const line of loaf) console.log(`  loaf ${line}`)
        const perFrame = stats(`scroll All topics ${label}, main-thread work per frame`, work)
        within(`scroll All topics ${label}, main-thread work per frame, p95`, perFrame.p95, 8.3)
        expect(loaf).toEqual([])
        expect(over / frames.length).toBeLessThan(0.01)
      }
      await sweep('first pass')
      await win.waitForTimeout(1_000)
      await sweep('second pass')
    } finally {
      await running.close()
    }
  })

  test('sidebar drag: main-thread work per frame while the edge moves', async () => {
    test.setTimeout(300_000)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { win } = running
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      // A topic open beside the list, so the drag reflows both panes.
      const first = (await juno.sidebar.titles())[0]!
      await juno.sidebar.row(first).open()
      await expect.poll(() => juno.topic.rowCount(), { timeout: 15_000 }).toBeGreaterThan(0)
      await win.evaluate(() => {
        const w = window as unknown as { __loaf: number }
        w.__loaf = 0
        new PerformanceObserver((entries) => {
          w.__loaf += entries.getEntries().length
        }).observe({ type: 'long-animation-frame', buffered: false })
      })
      const box = (await juno.frame.edge.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      const { work } = await traced(win, 'sidebar-drag', async () => {
        await win.mouse.move(x, y)
        await win.mouse.down()
        // Out to the widest, in to the narrowest and back: about 3 s of moves.
        for (const to of [x + 96, x - 104, x]) await win.mouse.move(to, y, { steps: 60 })
        await win.mouse.up()
      })
      const loaf = await win.evaluate(() => (window as unknown as { __loaf: number }).__loaf)
      const perFrame = stats('sidebar drag, main-thread work per frame', work)
      within('sidebar drag, main-thread work per frame, p95', perFrame.p95, 8.3)
      expect(loaf).toBe(0)
      await juno.frame.expectWidth(384)
    } finally {
      await running.close()
    }
  })
})

test('topic open, uncached: a thread whose replies were never fetched, to the header and what the store has', async () => {
  test.setTimeout(600_000)
  const samples: number[] = []
  for (let i = 0; i < 5; i++) {
    const fake = await startFakeSlack()
    const dir = await tempUserData()
    const appDir = await tempUserData()
    const slackApp = await writeSlackApp(fake, appDir)
    const running = await launchApp(dir, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    try {
      const juno = new Juno(running.app, running.win)
      await juno.signIn()
      await juno.waitForSync()
      await juno.sidebar.row('#eng').open()
      const threads = await juno.topic.openThreads()
      // Not followed, so the boot never fetched its replies.
      const before = (await juno.measures('juno.topic-open')).length
      await threads.open('checkout.spec failed again')
      await expect.poll(async () => (await juno.measures('juno.topic-open')).length).toBeGreaterThan(before)
      samples.push((await juno.measures('juno.topic-open')).at(-1)!)
      await juno.topic.expectMessage('Can you add a wait')
    } finally {
      await running.close()
      await fake.close()
      await rm(dir, { recursive: true, force: true })
      await rm(appDir, { recursive: true, force: true })
    }
  }
  const open = stats('topic open, uncached, press to header and stored rows painted (juno.topic-open)', samples)
  within('topic open uncached, p95', open.p95, 50)
})

// The M4 gate (performance 3.4) on the topic300 seed: a 300-message thread
// and a 300-message Main, 20 % images and 10 % code blocks. One synced
// user-data directory; every scenario launches the app warm on it.
test.describe('topic view', () => {
  let fake: FakeSlack
  let userData: string
  let slackDir: string
  let slackApp: SlackAppFixture
  const THREAD = 'Review the rollout checklist 1.'
  const MAIN = '#perf-main'

  const launch = (): Promise<RunningApp> => launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })

  /** Launches warm, waits for the sync, and closes any tab a previous launch left. */
  async function ready(): Promise<{ readonly running: RunningApp; readonly juno: Juno }> {
    const running = await launch()
    const juno = new Juno(running.app, running.win)
    await juno.sidebar.expectRows()
    await juno.expectEngineLive(120_000)
    for (let i = 0; i < 10 && (await juno.tabs.root.getByRole('tab').count()) > 0; i++) await juno.tabs.menu('close-tab')
    await juno.tabs.expectCount(0)
    await running.win.mouse.move(900, 400)
    return { running, juno }
  }

  /** Mouse down on a sidebar row without hovering it first, as a quick click does. */
  async function pressRow(juno: Juno, title: string): Promise<void> {
    const box = (await juno.sidebar.row(title).root.boundingBox())!
    await juno.win.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 1 })
    await press(juno.win)
  }

  async function nextMeasure(juno: Juno, name: string, before: number): Promise<number> {
    await expect.poll(async () => (await juno.measures(name)).length, { timeout: 15_000 }).toBeGreaterThan(before)
    return (await juno.measures(name)).at(-1)!
  }

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
    userData = await tempUserData()
    slackDir = await tempUserData()
    slackApp = await writeSlackApp(fake, slackDir)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      await juno.signIn()
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      // Read both once, so later opens are at the bottom of a cached, read topic. Main's oldest messages are
      // the user's, so its first open is at the "N new" divider after them, not at the bottom.
      for (const title of [THREAD, MAIN]) {
        await juno.sidebar.row(title).open()
        await juno.topic.toLatest()
        await juno.sidebar.row(title).expectRead()
      }
    } finally {
      await running.close()
    }
  })

  test.afterAll(async () => {
    await fake?.close()
    await rm(userData, { recursive: true, force: true })
    await rm(slackDir, { recursive: true, force: true })
  })

  test('topic open: cached, prefetched, and switching tabs', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    try {
      const cached: number[] = []
      const prefetched: number[] = []
      for (let i = 0; i < 10; i++) {
        // A topic the renderer has not read for over 30 s would be colder still; this is a quick click after a fresh launch window.
        for (const [title, samples] of [
          [THREAD, cached],
          [MAIN, cached],
        ] as const) {
          const before = (await juno.measures('juno.topic-open')).length
          await pressRow(juno, title)
          samples.push(await nextMeasure(juno, 'juno.topic-open', before))
          await juno.topic.expectAtBottom()
        }
      }
      await traced(running.win, 'topic-open-prefetched', async () => {
        for (let i = 0; i < 10; i++) {
          for (const title of [THREAD, MAIN]) {
            await juno.sidebar.row(title).hover()
            await running.win.waitForTimeout(300)
            const before = (await juno.measures('juno.topic-open')).length
            await juno.sidebar.row(title).open()
            prefetched.push(await nextMeasure(juno, 'juno.topic-open', before))
          }
        }
      })
      // Untimed: every frame of an open is painted at the bottom, with no correction after the first one.
      for (const title of [THREAD, MAIN, THREAD, MAIN]) {
        const stop = await juno.topic.watchBottom()
        const before = (await juno.measures('juno.topic-open')).length
        await pressRow(juno, title)
        await nextMeasure(juno, 'juno.topic-open', before)
        await running.win.waitForTimeout(300)
        const distances = await stop()
        expect(distances.length).toBeGreaterThan(5)
        expect(Math.max(...distances)).toBeLessThanOrEqual(2)
      }
      // Every row renders its hover toolbar, hidden until hover: its share of what an open builds.
      const dom = await running.win.evaluate(() => {
        const view = [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((node) => node.offsetParent !== null)
        const toolbars = [...(view?.querySelectorAll('[role="toolbar"][aria-label="Message actions"]') ?? [])]
        return { rows: view?.querySelectorAll('[data-message-row]').length ?? 0, elements: view?.getElementsByTagName('*').length ?? 0, toolbars: toolbars.length, inToolbars: toolbars.reduce((sum, bar) => sum + bar.getElementsByTagName('*').length + 1, 0) }
      })
      console.log(`topic open DOM: ${dom.rows} rows, ${dom.elements} elements, ${dom.toolbars} hover toolbars with ${dom.inToolbars} elements (${((100 * dom.inToolbars) / Math.max(1, dom.elements)).toFixed(0)} %)`)
      const oneFrame = oneFrameBudget(await refreshInterval(running.win))
      within('topic open cached, p95', stats('topic open, cached 300 rows, press to rows painted at position (juno.topic-open)', cached).p95, 50)
      within('topic open prefetched, p95', stats('topic open, prefetched (juno.topic-open)', prefetched).p95, oneFrame)

      // Tab switch: two mounted tabs.
      await juno.sidebar.row(THREAD).openInNewTab()
      await juno.tabs.expectCount(2)
      const mounted: number[] = []
      await traced(running.win, 'tab-switch-mounted', async () => {
        for (let i = 0; i < 20; i++) {
          const title = i % 2 === 0 ? 'perf-main' : THREAD
          const before = (await juno.measures('juno.tab-switch')).length
          await juno.tabs.select(title)
          mounted.push(await nextMeasure(juno, 'juno.tab-switch', before))
        }
      })
      within('tab switch mounted, p95', stats('tab switch, mounted (juno.tab-switch)', mounted).p95, oneFrame)
    } finally {
      await running.close()
    }
  })

  // Peek reads the query the row's hover warmed, so it is a prefetched open: one frame.
  test('peek: the peek key over a hovered row to the peeked messages painted', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    try {
      const samples: number[] = []
      await traced(running.win, 'peek-open', async () => {
        for (let i = 0; i < 10; i++) {
          for (const title of [THREAD, MAIN]) {
            await juno.sidebar.row(title).hover()
            await running.win.waitForTimeout(300)
            const before = (await juno.measures('juno.peek-open')).length
            await running.win.keyboard.down('Alt')
            samples.push(await nextMeasure(juno, 'juno.peek-open', before))
            await juno.peek.expectShowing(title)
            await juno.peek.release()
            await juno.peek.expectClosed()
          }
        }
      })
      within('peek open, p95', stats('peek open, key down to the peeked rows painted (juno.peek-open)', samples).p95, oneFrameBudget(await refreshInterval(running.win)))
    } finally {
      await running.close()
    }
  })

  test('scroll the 300-message thread, and prepend older pages with zero shift', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    const { win } = running
    try {
      await juno.sidebar.row(THREAD).open()
      await juno.topic.expectAtBottom()
      // Up to the top until the window holds the whole thread; each prepend must leave the row in view where it was.
      const shifts: number[] = []
      for (let page = 0; page < 3 && (await juno.topic.rowCount()) < 300; page++) {
        const count = await juno.topic.rowCount()
        await juno.topic.scrollToTop()
        const anchor = await juno.topic.firstVisibleRow()
        await expect.poll(() => juno.topic.rowCount(), { timeout: 15_000 }).toBeGreaterThan(count)
        await win.waitForTimeout(200)
        shifts.push(Math.abs((await juno.topic.rowTop(anchor.ts)) - anchor.top))
      }
      console.log(`prepend: rows ${await juno.topic.rowCount()}, anchor moved by ${shifts.map((s) => s.toFixed(1)).join(' ')} px`)
      expect(Math.max(...shifts)).toBeLessThan(1)

      const box = (await juno.topic.scroller.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const interval = await refreshInterval(win)
      let result = { frames: [] as number[], loaf: 0 }
      // About 2 000 px/s for 3 s, down then up, twice.
      const { work } = await traced(win, 'scroll-messages', async () => {
        await win.evaluate(() => {
          const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: number }
          w.__frames = []
          w.__loaf = 0
          w.__sampling = true
          new PerformanceObserver((entries) => {
            w.__loaf += entries.getEntries().length
          }).observe({ type: 'long-animation-frame', buffered: false })
          let last = performance.now()
          const tick = (now: number) => {
            w.__frames.push(now - last)
            last = now
            if (w.__sampling) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < 30; i++) {
            await win.mouse.wheel(0, 200)
            await win.waitForTimeout(100)
          }
          for (let i = 0; i < 30; i++) {
            await win.mouse.wheel(0, -200)
            await win.waitForTimeout(100)
          }
        }
        // Read before the trace ends: collecting it stalls the renderer too.
        result = await win.evaluate(() => {
          const w = window as unknown as { __frames: number[]; __sampling: boolean; __loaf: number }
          w.__sampling = false
          return { frames: w.__frames.slice(1), loaf: w.__loaf }
        })
      })
      const over = result.frames.filter((frame) => frame > interval * 1.5).length
      stats('scroll messages, frame interval', result.frames)
      const perFrame = stats('scroll messages, main-thread work per frame', work)
      console.log(`scroll messages: ${result.frames.length} frames, dropped (over 1.5 intervals) ${over} = ${((100 * over) / result.frames.length).toFixed(2)} %, long animation frames ${result.loaf}`)
      within('scroll messages, main-thread work per frame, p95', perFrame.p95, 8.3)
      expect(result.loaf).toBe(0)
      expect(over / result.frames.length).toBeLessThan(0.01)
    } finally {
      await running.close()
    }
  })

  test('tab switch back to an unmounted tab, restored at its scroll position', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    try {
      await juno.sidebar.row(THREAD).open()
      await juno.topic.expectAtBottom()
      // By wheel, as a user scrolls: rows reach their real height during the gesture, before the scroll ends.
      // A single 2,000px jump ends its scroll before the rows it shows are laid out.
      const box = (await juno.topic.scroller.boundingBox())!
      await running.win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 10; i++) {
        await running.win.mouse.wheel(0, -200)
        await running.win.waitForTimeout(50)
      }
      await running.win.waitForTimeout(500)
      const anchor = await juno.topic.firstVisibleRow()
      // Five more tabs push the thread's tab out of the mounted set: five small threads that mention the user.
      const extra = [1, 2, 3, 4, 5].map((k) => `Side topic ${k} ${Date.now()}`)
      for (const title of extra) {
        const root = fake.injectMessage({ channel: TOPIC300_MAIN_CHANNEL, user: 'U0PERFLEO', text: title })
        fake.injectMessage({ channel: TOPIC300_MAIN_CHANNEL, threadTs: root.ts, user: 'U0PERFMAYA', text: `<@U0TUSHAR> thoughts?` })
      }
      for (const title of extra) await juno.sidebar.row(title).openInNewTab()
      await juno.tabs.expectCount(1 + extra.length)
      const samples: number[] = []
      let before = (await juno.measures('juno.tab-switch')).length
      await juno.tabs.select(THREAD.slice(0, 20))
      samples.push(await nextMeasure(juno, 'juno.tab-switch', before))
      expect(Math.abs((await juno.topic.rowTop(anchor.ts)) - anchor.top)).toBeLessThan(2)
      // Round-robin over six tabs with five mounted: the next tab is always the one that was unmounted.
      for (let round = 0; round < 2; round++) {
        for (const title of extra) {
          before = (await juno.measures('juno.tab-switch')).length
          await juno.tabs.select(title)
          samples.push(await nextMeasure(juno, 'juno.tab-switch', before))
        }
      }
      within('tab switch unmounted, p95', stats('tab switch, unmounted with scroll restore (juno.tab-switch)', samples).p95, 50)
    } finally {
      await running.close()
    }
  })

  test('live update in the open thread: write to pixels', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    try {
      await juno.sidebar.row(THREAD).open()
      await juno.topic.expectAtBottom()
      const root = fake.messages(TOPIC300_THREAD_CHANNEL)[0]!
      // Every juno.live-update of the message list, before the next update of any route replaces it.
      const live = () => running.win.evaluate(() => (window as unknown as { __live: number[] }).__live.length)
      await running.win.evaluate(() => {
        const w = window as unknown as { __live: number[] }
        w.__live = []
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { detail?: { devtools?: { properties?: ReadonlyArray<readonly [string, unknown]> } } }>) {
            if (entry.name === 'juno.live-update' && entry.detail?.devtools?.properties?.some((property) => property[0] === 'route' && property[1] === 'messages.list')) w.__live.push(entry.duration)
          }
        }).observe({ type: 'measure' })
      })
      await traced(running.win, 'live-update', async () => {
        for (let i = 0; i < 9; i++) {
          const text = `Perf sample ${i} ${Date.now()}`
          const before = await live()
          fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, threadTs: root.ts, user: 'U0PERFLEO', text })
          // Polling a locator over 300 rows while the update is on its way runs on the renderer's main thread and would be measured with it.
          await expect.poll(live, { timeout: 15_000 }).toBeGreaterThan(before)
          await juno.topic.expectMessage(text)
          await juno.topic.expectAtBottom()
          await running.win.waitForTimeout(300)
        }
      })
      const measured = await running.win.evaluate(() => (window as unknown as { __live: number[] }).__live)
      within('live update in the topic, p95', stats('live update in the topic, engine commit to pixels (juno.live-update, messages.list)', measured).p95, 50)
    } finally {
      await running.close()
    }
  })
})
