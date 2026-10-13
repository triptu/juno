// The sidebar's numbers against docs/performance.md section 1, measured on
// the built app. Not part of the suite: the numbers depend on the machine
// and the budgets are checked by hand until the perf harness exists
// (performance.md 7.3). Each scenario prints its samples and the load
// average; the filter scenario also fails on a frame with no rows.
//
//   JUNO_PERF=1 pnpm --filter @juno/desktop exec playwright test e2e/perf.spec.ts
import { rm } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { largeSeed, startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { expect, launchApp, tempUserData, test, writeSlackApp, type RunningApp, type SlackAppFixture } from './fixtures'
import { Juno, type SidebarFilterName } from './driver/juno'

test.skip(process.env['JUNO_PERF'] !== '1', 'set JUNO_PERF=1 to measure')

const POSTGRES = 'Draft plan is in the doc'

function stats(name: string, samples: ReadonlyArray<number>): { readonly median: number; readonly p95: number } {
  const sorted = samples.toSorted((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const median = at(0.5)
  const p95 = at(0.95)
  const load = loadavg()[0]!.toFixed(1)
  console.log(`${name}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, n=${samples.length}, load ${load}, samples ${sorted.map((s) => s.toFixed(1)).join(' ')}`)
  return { median, p95 }
}

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
  stats('row hover (pointerover event) to next frame presented', samples)
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
  stats('live update, engine commit to pixels (juno.live-update)', measured)
  // Includes the fake's socket frame, the engine's merge, and Playwright's own polling.
  stats('live update, inject call to new preview seen by Playwright', wall)
})

// The large-workspace scenarios share one synced user-data directory: the
// fake's 1,200-topic seed fills the 300-row window, and syncing it once
// keeps the run short. Every scenario launches the app warm on it.
test.describe.serial('large workspace', () => {
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
      } finally {
        await running.close()
      }
    }
    console.log(`rows in the window: ${runs.map((run) => run.rows).join(' ')}`)
    stats('warm start, main process created to shell painted', runs.map((run) => run.mainToShell))
    stats('warm start, main process created to sidebar rows painted', runs.map((run) => run.mainToRows))
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
      stats('filter change, press to new list painted (juno.filter)', durations)
      expect(frames.blank).toBe(0)
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
      const sweep = async (label: string) => {
        await win.evaluate(() => {
          const w = window as unknown as { __frames: number[]; __sampling: boolean }
          w.__frames = []
          w.__sampling = true
          let last = performance.now()
          const tick = (now: number) => {
            w.__frames.push(now - last)
            last = now
            if (w.__sampling) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        // About 2 000 px/s for 3 s, down then up.
        for (let i = 0; i < 30; i++) {
          await win.mouse.wheel(0, 200)
          await win.waitForTimeout(100)
        }
        for (let i = 0; i < 30; i++) {
          await win.mouse.wheel(0, -200)
          await win.waitForTimeout(100)
        }
        const frames = await win.evaluate(() => {
          const w = window as unknown as { __frames: number[]; __sampling: boolean }
          w.__sampling = false
          return w.__frames.slice(1)
        })
        const loaf = await win.evaluate(() => {
          const w = window as unknown as { __loaf: string[] }
          const out = w.__loaf
          w.__loaf = []
          return out
        })
        const sorted = frames.toSorted((a, b) => a - b)
        const p95 = sorted[Math.floor(0.95 * sorted.length)] ?? 0
        const max = sorted[sorted.length - 1] ?? 0
        const over = frames.filter((f) => f > 16.7 * 1.5).length
        console.log(`scroll ${label}: ${frames.length} frames, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, frames over 25 ms ${over}, long animation frames ${loaf.length}, load ${loadavg()[0]!.toFixed(1)}`)
        for (const line of loaf) console.log(`  loaf ${line}`)
      }
      // The first pass lays out rows the window has never shown; the second is the steady state.
      await sweep('first pass')
      await win.waitForTimeout(1000)
      await sweep('second pass')
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
})
