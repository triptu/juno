// The sidebar's numbers against docs/performance.md section 1, measured on
// the built app. Not part of the suite: the numbers depend on the machine
// and the budgets are checked by hand until the perf harness exists
// (performance.md 7.3). Each scenario prints its samples.
//
//   JUNO_PERF=1 pnpm --filter @juno/desktop exec playwright test e2e/perf.spec.ts
import { rm } from 'node:fs/promises'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { expect, launchApp, tempUserData, test, writeSlackApp } from './fixtures'
import { Juno } from './driver/juno'

test.skip(process.env['JUNO_PERF'] !== '1', 'set JUNO_PERF=1 to measure')

const POSTGRES = 'Draft plan is in the doc.'

function stats(name: string, samples: ReadonlyArray<number>): { readonly median: number; readonly p95: number } {
  const sorted = samples.toSorted((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const median = at(0.5)
  const p95 = at(0.95)
  console.log(`${name}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, n=${samples.length}, samples ${sorted.map((s) => s.toFixed(1)).join(' ')}`)
  return { median, p95 }
}

test('warm start: first sidebar rows from the local cache', async ({ fake, slackApp }) => {
  test.setTimeout(300_000)
  const userData = await tempUserData()
  try {
    const first = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    const juno = new Juno(first.app, first.win)
    await juno.signIn()
    await juno.waitForSync()
    await first.close()

    const fromStart: number[] = []
    const fromLaunch: number[] = []
    for (let i = 0; i < 5; i++) {
      const launched = Date.now()
      const again = await launchApp(userData, { fakeSlackUrl: fake.url })
      try {
        const sidebar = new Juno(again.app, again.win).sidebar
        await sidebar.row(POSTGRES).expectVisible()
        fromLaunch.push(Date.now() - launched)
        await expect.poll(() => new Juno(again.app, again.win).measure('juno.sidebar-rows')).not.toBeUndefined()
        fromStart.push((await new Juno(again.app, again.win).measure('juno.sidebar-rows'))!)
      } finally {
        await again.close()
      }
    }
    // The in-page measure runs from the renderer's first script to the rows' paint.
    stats('warm start, renderer script start to sidebar rows painted', fromStart)
    // The wall clock includes Electron's process start and the window.
    stats('warm start, launch call to first row visible to Playwright', fromLaunch)
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
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

test('scroll frame times on a large workspace', async () => {
  test.setTimeout(900_000)
  // Enough topics to fill the 300-row window; fewer messages than the full
  // large seed so the first sync fits the test.
  const fake = await startFakeSlack({ seed: largeSeed({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }) })
  const userData = await tempUserData()
  try {
    const slackApp = await writeSlackApp(fake, userData)
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    try {
      const juno = new Juno(running.app, running.win)
      const { win } = running
      await juno.signIn()
      await juno.sidebar.expectRows()
      await juno.accountMenu.open()
      await expect(juno.accountMenu.engineStatus).toHaveText('Engine live', { timeout: 600_000 })
      await juno.accountMenu.close()
      const rows = await juno.sidebar.rows.count()
      console.log(`rows in the window: ${rows}`)

      const list = juno.sidebar.list
      const box = (await list.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const longBefore = await win.evaluate(() => (window as unknown as { __juno: { perf: { longFrames: number } } }).__juno.perf.longFrames)
      // A frame sampler for the length of the scroll.
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
      const longAfter = await win.evaluate(() => (window as unknown as { __juno: { perf: { longFrames: number } } }).__juno.perf.longFrames)
      const sorted = frames.toSorted((a, b) => a - b)
      const p95 = sorted[Math.floor(0.95 * sorted.length)] ?? 0
      const max = sorted[sorted.length - 1] ?? 0
      const over = frames.filter((f) => f > 16.7 * 1.5).length
      console.log(`scroll: ${frames.length} frames, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, frames over 25 ms ${over}, long animation frames ${longAfter - longBefore}`)
      console.log(`scrollTop after the run: ${await list.evaluate((node) => node.scrollTop)}`)
    } finally {
      await running.close()
    }
  } finally {
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})
