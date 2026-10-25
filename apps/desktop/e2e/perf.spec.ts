// Juno's numbers against docs/performance.md section 1, measured on the
// built app. Not part of `test:e2e`: the numbers depend on the machine, so
// the scenarios run on their own through the heavy-job lock. Each one prints
// its samples and the load average and fails when a p95 (or a p50 where the
// budget says so) is over its budget.
//
//   bun run perf                  every scenario
//   bun run perf -g "topic view"  some of them
//   JUNO_PERF_TRACE=<dir>      also write traces and CPU profiles (scripts/perf-trace.mjs)
import { rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { loadavg } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { codeBlocksSeed, CODE_BLOCK_COUNT, largeSeed, startFakeSlack, topic300Seed, TOPIC300_MAIN_CHANNEL, TOPIC300_THREAD_CHANNEL, type FakeSlack } from '@juno/fake-slack'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { expect, hooks, launchApp, syncedTest, tempUserData, test, writeSlackApp, type RunningApp, type SlackAppFixture } from './fixtures'
import { privateMemory, stats } from './perfStats'
import { absolute, budget, reading } from './perfBaseline'
import { recordTrace, traced } from './perfTrace'
import { scrollReading } from './perfScroll'
import { selectionDragReading } from './perfSelection'
import { HEAVY_MEMORY_BUDGETS, heavyUse, memoryDump, readMemory } from './perfMemory'
import { typingReading } from './perfTyping'
import { answer } from './juno-agent/chat'
import { savedTabs } from './driver/userDb'
import { Juno, press, type Landing, type SidebarFilterName } from './driver/juno'

declare global {
  interface Window { __emojiBenchmarkReleaseImages: () => Promise<void> }
}

test.skip(process.env['JUNO_PERF'] !== '1', 'set JUNO_PERF=1 to measure')

const POSTGRES = 'Draft plan is in the doc'

/**
 * Scenarios on the default seed. The laptop starts them from the synced copy (README, "Synced start"), a warm
 * boot with no sign-in; the Mac keeps a real sign-in, so its numbers stay comparable with earlier Mac runs.
 */
const defaultSeedTest = absolute ? test : syncedTest
async function signedIn(juno: Juno): Promise<void> {
  if (!absolute) return
  await juno.signIn()
  await juno.waitForSync()
}

/**
 * Samples per scenario: the laptop's count, a median for its baseline check, or the Mac's, a p95 against the
 * absolute budget (perfBaseline.ts).
 */
const count = (laptop: number, mac: number): number => absolute ? mac : laptop

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
 * The budget for a character to reach the screen: within one refresh
 * interval of a bare `<input>` measured in the same run. The bare input runs
 * no app code, so its p95 is the floor Electron, the compositor and the
 * display set on this machine (about 38 ms in 10-15 runs); an absolute
 * one-frame budget fails on it too (performance.md 1, 7.1).
 */
function characterBudget(control: number, interval: number): number {
  return control + interval
}

/** Types into a bare `<input>` laid over the window: the floor for a character, with no app code. */
async function nativeControl(win: Page, name: string, type: (input: ReturnType<Page['locator']>) => Promise<void>) {
  await win.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'perf-input'
    input.style.cssText = 'position:fixed;top:100px;left:500px;z-index:9999;background:white;color:black'
    document.body.append(input)
  })
  const input = win.locator('#perf-input')
  try {
    await input.focus()
    return await typingReading(win, input, name, () => type(input))
  } finally {
    await input.evaluate((node) => node.remove())
  }
}

/**
 * Rejects hidden or unfocused samples. Other desktop runs can steal focus
 * without hiding the page; their scheduling and pointer events contaminate
 * input-to-paint measurements too.
 */
async function countHidden(win: Page): Promise<() => Promise<number>> {
  await win.evaluate(() => {
    const w = window as unknown as { __hidden: number }
    w.__hidden = document.visibilityState === 'hidden' || !document.hasFocus() ? 1 : 0
    window.addEventListener('blur', () => { w.__hidden++ })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') w.__hidden++
    })
  })
  return () => win.evaluate(() => (window as unknown as { __hidden: number }).__hidden)
}

// The floor under every input-to-paint measure: a pointerdown that does no
// work, to the first moment after the next presented frame, timed the way
// `afterPaint` times the app's measures. On a 60 Hz display it spreads over
// one 16.7 ms frame however fast the app is.
// A diagnostic of the display, with no budget: on the Mac only.
if (absolute) test('frame floor: input with no work to the next frame', async ({ juno, win }) => {
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

defaultSeedTest('keystroke controls: composer, composer with a long draft, bare input and palette', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await signedIn(juno)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const hidden = await countHidden(win)
  const interval = await refreshInterval(win)
  const rounds = count(2, 4)
  const typeRounds = (input: ReturnType<Page['locator']>) => async () => {
    for (let round = 0; round < rounds; round++) {
      await input.pressSequentially('deployment')
      await win.waitForTimeout(150)
    }
  }
  const report = (surface: string, result: Awaited<ReturnType<typeof typingReading>>) => {
    stats(`${surface}, Event Timing keydown/keypress >=16 ms (diagnostic)`, result.events)
    const presented = stats(`${surface}, input timestamp to character presented`, result.presented)
    stats(`${surface}, input to animation frame callback`, result.frame)
    stats(`${surface}, animation frame callback to presentation`, result.afterFrame)
    expect(result.count).toBe(rounds * 10)
    return presented
  }
  // The control first: the other surfaces are measured against it.
  const control = report('bare input', await nativeControl(win, 'typing-bare-input', (input) => typeRounds(input)()))
  const limit = characterBudget(control.p95, interval)
  console.log(`character budget: bare input p95 ${control.p95.toFixed(1)} ms + one refresh interval ${interval.toFixed(1)} ms = ${limit.toFixed(1)} ms`)
  // A long draft full of Slack markup: the field draws its look again on each keystroke (spec section 8).
  const markup = `${Array.from({ length: 30 }, (_, i) => `> *Point ${i}* with _some_ \`code\` and ~old~ words, then more text so that the line wraps`).join('\n')}\n\`\`\`\n${'const total = await sum(rows)\n'.repeat(20)}\`\`\`\n`
  for (const surface of ['composer', 'composer with a long draft', 'palette']) {
    if (surface === 'palette') await juno.palette.open()
    const input = surface === 'palette' ? juno.palette.input : juno.topic.composer
    const draft = surface === 'composer with a long draft' ? markup : ''
    await input.fill(draft)
    await input.focus()
    await input.evaluate((field: HTMLTextAreaElement | HTMLInputElement) => field.setSelectionRange(field.value.length, field.value.length))
    const presented = report(surface, await typingReading(win, input, `typing-${surface.replace(/ /g, '-')}`, typeRounds(input)))
    await expect(input).toHaveValue(draft + 'deployment'.repeat(rounds))
    budget(presented, limit, { floor: interval })
  }
  expect(await hidden()).toBe(0)
})

defaultSeedTest('row hover to paint', async ({ juno, win }) => {
  test.setTimeout(120_000)
  await signedIn(juno)
  const measureHovers = async () => {
    const rows = juno.sidebar.rows
    const hovers = Math.min(await rows.count(), count(7, 9))
    const samples: number[] = []
    for (let i = 0; i < hovers; i++) {
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
    budget(hover, oneFrameBudget(await refreshInterval(win)))
  }
  if (process.env['JUNO_PERF_TRACE'] !== undefined) await traced(win, 'row-hover', measureHovers)
  else await measureHovers()
})

/** Records the next pointerdown on the sidebar's Home button to Home painted in `window.__homeSample`. */
async function armHomeSample(nav: Locator): Promise<void> {
  await nav.evaluate((node) => {
    const w = window as unknown as { __homeSample?: Promise<number> }
    w.__homeSample = new Promise((resolve) => {
      node.addEventListener(
        'pointerdown',
        (event) => {
          const start = event.timeStamp
          const shown = () => document.querySelector('[data-home]:not([data-home-waiting]) [data-home-item]') !== null
          const frame = () => requestAnimationFrame(() => {
            if (!shown()) return frame()
            setTimeout(() => {
              const end = performance.now()
              performance.measure('juno.home-open', { start, end })
              resolve(end - start)
            }, 0)
          })
          frame()
        },
        { once: true },
      )
    })
  })
}

// Home from the sidebar's Home button, with a topic open in the tab: the
// pointerdown to the first presented frame that shows Home's greeting and
// rows, read from the local cache (performance.md section 1, "Home open").
// Every fourth sample comes back after 31 s idle, past the home.view
// atom's idle time, when the CPU has slowed down. The pointer entering the
// Home button warms home.view (performance.md 4.2), and that prefetch is still
// held here, so these opens render cached data on a slow CPU. They have
// their own budget, 150 ms; the quick opens keep 50 ms (performance.md 1).
// The slowdown after idle is Apple silicon's power management, so the
// laptop takes quick opens only.
defaultSeedTest('home open: from a topic to Home painted', async ({ juno, win }) => {
  test.setTimeout(360_000)
  const idleEvery = absolute ? 4 : 0
  await signedIn(juno)
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
  const idle: number[] = []
  const cold: string[] = []
  const afterIdle = (i: number) => idleEvery > 0 && i % idleEvery === idleEvery - 1
  for (let i = 0; i < count(7, 20); i++) {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await win.waitForTimeout(afterIdle(i) ? 31_000 : 300)
    const nav = home.navItem
    const queries = await win.evaluate(() => (window as unknown as { __homeQuery: number[] }).__homeQuery.length)
    await armHomeSample(nav)
    // `press`, not `click`: a pointerup in the next frame defers the end of the measure by a frame (performance.md 7.1).
    const box = (await nav.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const measureOpen = async () => {
      await press(win)
      const sample = await win.evaluate(() => (window as unknown as { __homeSample: Promise<number> }).__homeSample)
      if (afterIdle(i)) idle.push(sample)
      else samples.push(sample)
    }
    if (process.env['JUNO_PERF_TRACE'] !== undefined) await traced(win, `home-open-${i}`, measureOpen)
    else await measureOpen()
    if (afterIdle(i)) {
      await win.waitForTimeout(100)
      const query = await win.evaluate((from) => (window as unknown as { __homeQuery: number[] }).__homeQuery.slice(from), queries)
      cold.push(`${idle.at(-1)!.toFixed(1)} ms (home.view ${query.map((ms) => ms.toFixed(1)).join(', ') || 'no run'})`)
    }
  }
  const open = stats('home open, quick (pointerdown on Home) to Home painted', samples)
  budget(open, 50)
  if (idle.length === 0) return
  console.log(`home open after the subscription's idle time: ${cold.join('; ')}`)
  budget(stats('home open after 31 s idle (pointerdown on Home) to Home painted', idle), 150)
})

// A click on a picture in a message to the first presented frame that
// shows the media viewer with its item and filmstrip (performance.md section
// 1, "Media viewer open"). The viewer's chunk is preloaded once a topic has
// painted, so this is the overlay's own cost.
defaultSeedTest('media viewer open: a picture in a message to the viewer painted', async ({ juno, win, fake }) => {
  test.setTimeout(180_000)
  await signedIn(juno)
  const { sidebar, topic } = juno
  await sidebar.row('#eng').open()
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Photos for the viewer check', media: Array.from({ length: 6 }, (_, index) => ({ name: `photo-${index + 1}.png`, width: 1200, height: 800 + index * 40 })) })
  const row = topic.message('Photos for the viewer check')
  const tiles = row.locator('[data-thumbnail]')
  await expect(tiles).toHaveCount(4)
  const samples: number[] = []
  for (let i = 0; i < count(8, 16); i++) {
    const tile = tiles.nth(i % 4)
    // The topic opens at its divider, so the new message can sit under the composer.
    await tile.scrollIntoViewIfNeeded()
    await tile.evaluate((node) => {
      const w = window as unknown as { __viewerSample?: Promise<number> }
      w.__viewerSample = new Promise((resolve) => {
        // A tile opens on `click`; timing it from pointerdown would add the driver's 60 ms hold.
        node.addEventListener(
          'click',
          (event) => {
            const start = event.timeStamp
            const shown = () => document.querySelector('[data-media-viewer] [data-viewer-item]') !== null && document.querySelector('[data-media-viewer] [data-filmstrip]') !== null
            const frame = () => requestAnimationFrame(() => {
              if (!shown()) return frame()
              setTimeout(() => {
                const end = performance.now()
                performance.measure('juno.viewer-open', { start, end })
                resolve(end - start)
              }, 0)
            })
            frame()
          },
          { once: true },
        )
      })
    })
    const box = (await tile.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const measureOpen = async () => {
      await press(win)
      samples.push(await win.evaluate(() => (window as unknown as { __viewerSample: Promise<number> }).__viewerSample))
    }
    if (process.env['JUNO_PERF_TRACE'] !== undefined) await traced(win, `viewer-open-${i}`, measureOpen)
    else await measureOpen()
    await win.keyboard.press('Escape')
    await expect(win.locator('[data-media-viewer]')).toHaveCount(0)
    await win.waitForTimeout(200)
  }
  const open = stats('media viewer open (click on a picture) to the viewer painted', samples)
  budget(open, 50)
})

defaultSeedTest('live update: a reply from another client to pixels', async ({ juno, fake }) => {
  test.setTimeout(120_000)
  await signedIn(juno)
  const postgres = juno.sidebar.row(POSTGRES)
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(POSTGRES))!
  const measured: number[] = []
  const wall: number[] = []
  for (let i = 0; i < count(7, 9); i++) {
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
  budget(live, 50)
  // Includes the fake's socket frame, the engine's merge, and Playwright's own polling.
  stats('live update, inject call to new preview seen by Playwright', wall)
})

defaultSeedTest('send: Enter to the pending row painted', async ({ juno }) => {
  test.setTimeout(120_000)
  await signedIn(juno)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const hidden = await countHidden(juno.win)
  const measured: number[] = []
  for (let i = 0; i < count(9, 30); i++) {
    const text = `Perf send ${i} ${Date.now()}`
    const before = (await juno.measures('juno.send')).length
    await juno.topic.send(text)
    await juno.topic.expectSent(text)
    // The measure ends after the frame is presented, which can be after the row settles.
    await expect.poll(async () => (await juno.measures('juno.send')).length, { timeout: 15_000 }).toBeGreaterThan(before)
    measured.push((await juno.measures('juno.send')).at(-1)!)
    if (measured.at(-1)! > 50) {
      const stages = await juno.win.evaluate(() => {
        const start = performance.getEntriesByName('juno.send', 'mark').at(-1)!.startTime
        return ['checked', 'queued', 'commit'].map((stage) => {
          const at = performance.getEntriesByName(`juno.send-${stage}`, 'mark').at(-1)?.startTime
          return `${stage} ${at !== undefined && at >= start ? `+${(at - start).toFixed(1)} ms` : 'not recorded'}`
        }).join(', ')
      })
      console.log(`slow send ${i}: ${measured.at(-1)!.toFixed(1)} ms; ${stages}`)
    }
    await juno.win.waitForTimeout(300)
  }
  expect(await hidden(), 'the window lost focus or was hidden while measuring; this sample is contended').toBe(0)
  // The checks on send (clarity here), a local transaction, the delta and the paint; the Slack call is not part of it.
  const send = stats('send, Enter to the pending row painted (juno.send)', measured)
  budget(send, 50)
})

// Typing "@ma " or ":smi " in a reply, ten times over: each input to its
// character presented, measured like the keystroke controls (`perfTyping.ts`,
// performance.md 7.1). Every "@" opens the suggestions and each letter
// narrows them; the field draws its text through the chip layer. Soft
// against the budget, as the plain composer control is: the presentation
// measure misses it on a bare input too (performance.md 7.1).
for (const { kind, query } of [{ kind: 'mention', query: '@ma' }, { kind: 'emoji', query: ':smi' }]) {
  defaultSeedTest(`${kind} typing: each keystroke of "${query}" to its character presented`, async ({ juno, win }) => {
    test.setTimeout(120_000)
    await signedIn(juno)
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    const hidden = await countHidden(win)
    const interval = await refreshInterval(win)
    const rounds = count(4, 10)
    // The same keys in a bare input first: the floor the composer is held to.
    const control = stats(`${kind} typing, bare input (control) input timestamp to character presented`, (await nativeControl(win, `typing-${kind}-control`, async (field) => {
      for (let round = 0; round < rounds; round++) {
        await field.pressSequentially(`${query} `)
        await win.waitForTimeout(150)
      }
    })).presented)
    const limit = characterBudget(control.p95, interval)
    const input = juno.topic.composer
    await input.fill('')
    await input.focus()
    const result = await typingReading(win, input, `typing-${kind}`, async () => {
      for (let round = 0; round < rounds; round++) {
        await input.pressSequentially(`${query} `)
        await win.waitForTimeout(150)
      }
    })
    expect(result.count).toBe((query.length + 1) * rounds)
    await expect(input).toHaveValue(`${query} `.repeat(rounds))
    // Check rows outside timing: the driver's visibility assertion forces layout.
    if (kind === 'emoji') {
      await input.pressSequentially(query)
      await expect(juno.topic.suggestions).toBeVisible()
    }
    expect(await hidden(), 'the window was hidden or covered while measuring, so its frames were not drawn').toBe(0)
    stats(`${kind} typing, Event Timing keydown/keypress >=16 ms (diagnostic)`, result.events)
    const presented = stats(`${kind} typing, input timestamp to character presented`, result.presented)
    stats(`${kind} typing, input to animation frame callback`, result.frame)
    stats(`${kind} typing, animation frame callback to presentation`, result.afterFrame)
    // By key: which part of the query is slow to show (the trigger that opens the list, a letter that narrows it, the space that closes it).
    const keys = [...`${query} `]
    console.log(`${kind} typing by key, input to character presented, median / max: ${keys.map((key, at) => {
      const own = result.presented.filter((_, i) => i % keys.length === at).toSorted((a, b) => a - b)
      return `"${key}" ${own[Math.floor(own.length / 2)]!.toFixed(1)} / ${own.at(-1)!.toFixed(1)}`
    }).join(', ')}`)
    budget(presented, limit, { floor: interval })
  })
}

/** Measures the first frame containing the finished content, starting at the actual input. */
async function firstOpen(win: Page, eventType: 'click' | 'pointerdown' | 'pointerup', selector: string, action: () => Promise<void>): Promise<number> {
  await win.evaluate(({ selector, eventType }) => {
    const w = window as unknown as { __firstOpen: Promise<number> }
    w.__firstOpen = new Promise((resolve) => {
      window.addEventListener(eventType, (event) => {
        const tick = () => {
          const content = document.querySelector<HTMLElement>(selector)
          if (content?.checkVisibility()) setTimeout(() => resolve(performance.now() - event.timeStamp), 0)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }, { once: true, capture: true })
    })
  }, { selector, eventType })
  await action()
  return win.evaluate(() => (window as unknown as { __firstOpen: Promise<number> }).__firstOpen)
}

defaultSeedTest('first open in a second app: account menu, topic switcher, emoji picker and Settings', async ({ juno, fake, slackApp, userData, running }) => {
  test.setTimeout(120_000)
  await signedIn(juno)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const fresh = new Juno(again.app, again.win)
    await fresh.waitForSync()
    const hidden = await countHidden(again.win)
    const measure = async (name: string, selector: string, action: () => Promise<void>) => {
      const elapsed = await firstOpen(again.win, 'pointerdown', selector, action)
      budget(stats(`${name}, first open in a second app`, [elapsed]), 50)
    }
    await measure('account menu', '[role="menuitem"]', async () => {
      await fresh.sidebar.accountButton.hover()
      await press(again.win)
    })
    await expect(fresh.accountMenu.item(/^Settings/)).toBeVisible()
    await fresh.accountMenu.close()
    await fresh.sidebar.row(POSTGRES).open()
    await fresh.topic.expectTitle(POSTGRES)
    await again.win.waitForTimeout(500)
    await measure('topic switcher', '[role="dialog"] [role="option"]', async () => {
      await fresh.topic.titleButton.hover()
      await press(again.win)
    })
    await expect(again.win.getByRole('textbox', { name: 'Search this channel' })).toBeFocused()
    await again.win.keyboard.press('Escape')
    // The message menu opens as the right-click comes up, then More reactions turns it into the emoji picker.
    const row = fresh.topic.list.locator('[data-message-row]').last()
    const text = (await row.locator('[data-msg-text]').first().boundingBox())!
    await again.win.mouse.move(text.x + 8, text.y + 8)
    await again.win.mouse.down({ button: 'right' })
    budget(stats('message menu, first open in a second app', [await firstOpen(again.win, 'pointerup', '[data-context-menu] [data-menu-cell]', () => again.win.mouse.up({ button: 'right' }))]), 50)
    await measure('emoji picker', '[data-emoji-picker] [data-emoji]', async () => {
      await fresh.messageMenu.more.hover()
      await press(again.win)
    })
    await expect(again.win.getByRole('textbox', { name: 'Search emoji' })).toBeFocused()
    await again.win.keyboard.press('Escape')
    await fresh.accountMenu.open()
    await measure('Settings', 'nav[aria-label="Settings"]', async () => {
      await fresh.accountMenu.item(/^Settings/).hover()
      await press(again.win)
    })
    await expect(fresh.settings.section('General')).toHaveAttribute('aria-current', 'page')
    expect(await hidden()).toBe(0)
  } finally {
    await again.close()
  }
})

defaultSeedTest('send in Main: Enter through the checks on send to the pending row painted, with a slow model', async ({ juno, fake, slackApp, userData, running }) => {
  test.setTimeout(180_000)
  await signedIn(juno)
  await running.close()
  // The model takes a second; Enter comes while it is still answering the typing pause.
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeAiDelayMillis: 1_000 })
  try {
    const slow = new Juno(again.app, again.win)
    // The relaunch catches up with Slack first; measure once it is live, as the other scenarios do.
    await slow.waitForSync()
    await slow.sidebar.row('#eng').open()
    await slow.topic.expectTitle('Main')
    const hidden = await countHidden(slow.win)
    const measured: number[] = []
    for (let i = 0; i < count(7, 9); i++) {
      const text = `Perf main ${i} ${Date.now()}`
      const before = (await slow.measures('juno.send')).length
      await slow.topic.composer.fill(text)
      // Past the 400 ms pause, so the wrong-place question is with the model when Enter comes.
      await slow.win.waitForTimeout(500)
      await slow.topic.composer.press('Enter')
      await slow.topic.expectSent(text)
      await expect.poll(async () => (await slow.measures('juno.send')).length, { timeout: 15_000 }).toBeGreaterThan(before)
      measured.push((await slow.measures('juno.send')).at(-1)!)
      await slow.win.waitForTimeout(300)
    }
    expect(await hidden(), 'the window lost focus or was hidden while measuring; this sample is contended').toBe(0)
    // Enter reads the store only: the model's second is not part of it.
    const send = stats('send in Main with a 1 s model, Enter through the checks to the pending row painted (juno.send)', measured)
    budget(send, 50)
  } finally {
    await again.close()
  }
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
  // One worker runs the group on its synced workspace, while the laptop's other workers take other scenarios.
  test.describe.configure({ mode: 'default' })
  let fake: FakeSlack
  let userData: string
  let slackDir: string
  let slackApp: SlackAppFixture

  const launch = (agent = false): Promise<RunningApp> => launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent })

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
      if (process.env['JUNO_PERF_TOPIC_TITLES'] === 'two') {
        await juno.openSettings('Appearance')
        await running.win.getByRole('radio', { name: 'Two lines', exact: true }).click()
        await expect(running.win.locator('html')).toHaveAttribute('data-topic-title-lines', 'two')
        await juno.home.open()
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

  test('launch warm start: show the hidden sidebar', async () => {
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { win } = running
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      const samples: number[] = []
      for (let i = 0; i < count(7, 8); i++) {
        await juno.frame.toggleWithButton()
        const show = win.getByRole('button', { name: /^Show sidebar/ }).locator('visible=true')
        await show.evaluate((node) => {
          const state = window as unknown as { sidebarReveal?: Promise<number> }
          state.sidebarReveal = new Promise((resolve) => {
            node.addEventListener('click', (event) => {
              requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - event.timeStamp), 0))
            }, { once: true })
          })
        })
        await show.click()
        samples.push(await win.evaluate(() => (window as unknown as { sidebarReveal: Promise<number> }).sidebarReveal))
        await juno.sidebar.expectRows()
      }
      budget(stats('show sidebar, click to frame presented', samples), oneFrameBudget(await refreshInterval(win)))
    } finally {
      await running.close()
    }
  })

  test('launch warm start: main process to shell and rows, snapshot to rows, the longest frame', async () => {
    test.setTimeout(300_000)
    const runs: Array<Awaited<ReturnType<Juno['startupTimes']>>> = []
    const composers: number[] = []
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
        const [created, renderer, marks] = await running.app.evaluate(({ app }) => {
          const metrics = app.getAppMetrics()
          const startup = { ...(globalThis as unknown as { junoStartupMarks: Record<string, number> }).junoStartupMarks }
          return [metrics.find((metric) => metric.type === 'Browser')?.creationTime ?? 0, metrics.find((metric) => metric.type === 'Tab')?.creationTime ?? Number.NaN, startup] as const
        })
        const page = await running.win.evaluate(() => {
          const first = (name: string) => performance.getEntriesByName(name, 'mark')[0]?.startTime ?? Number.NaN
          return { origin: performance.timeOrigin, start: first('juno.start'), snapshot: first('juno.sidebar-snapshot'), composer: first('juno.composer-ready') }
        })
        if (i > 0) composers.push(page.origin + page.composer - created)
        // Main's own steps from the process's creation (src/main/startupMarks.ts): its bundle has loaded, ready, the scheme served,
        // the window asked for and made, the engine forked and ready, ready-to-show.
        if (i > 0) console.log(`warm start ${i}: main ${['loaded', 'ready', 'scheme', 'window', 'window-made', 'engine-fork', 'engine-ready', 'shown'].map((name) => `${name} ${((marks[name] ?? Number.NaN) - created).toFixed(0)}`).join(', ')}`)
        if (i > 0) console.log(`warm start ${i}: main to renderer process ${(renderer - created).toFixed(0)} ms, to navigation ${(page.origin - created).toFixed(0)} ms, bundle run at +${page.start.toFixed(0)}, sidebar snapshot at +${page.snapshot.toFixed(0)}, shell at +${(created + times.mainToShell - page.origin).toFixed(0)}, rows at +${(created + times.mainToRows - page.origin).toFixed(0)}`)
      } finally {
        await running.close()
      }
    }
    expect(composers.every(Number.isFinite)).toBe(true)
    stats('launch to focused composer', composers)
    console.log(`rows in the window: ${runs.map((run) => run.rows).join(' ')}`)
    stats('warm start, main process created to shell painted', runs.map((run) => run.mainToShell))
    const rows = stats('warm start, main process created to sidebar rows painted', runs.map((run) => run.mainToRows))
    budget(rows, 500, { at: 'median' })
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
      for (let round = 0; round < count(3, 5); round++) {
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
      budget(filter, 50)
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
      const warmed = await juno.lastMark('juno.prefetch')
      await scrollReading(win, 'scroll-sidebar', { steps: 30, direction: 1, interval: await refreshInterval(win), layoutLimit: 2000, at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } })
      // Rows that scroll under the still pointer are not warmed (performance.md 3.2).
      expect(await juno.lastMark('juno.prefetch')).toBe(warmed)
      console.log(`scrollTop after the run: ${await list.evaluate((node) => node.scrollTop)}`)

      // Memory per process: private memory, the budgets' metric (performance.md 1), and the working set, which
      // follows the Mac's memory pressure more than the code (8.9). Then the renderer's JS heap and DOM size.
      const metrics = await running.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, name: metric.serviceName ?? metric.name ?? '', mb: metric.memory.workingSetSize / 1024 })))
      for (const metric of metrics) {
        const own = privateMemory(metric.pid)
        console.log(`memory ${metric.type}${metric.name ? ` ${metric.name}` : ''}: ${own === undefined ? '' : `${own.toFixed(0)} MB private, `}${metric.mb.toFixed(0)} MB working set`)
      }
      // The engine is listed as a Node service, not by its service name; main knows its pid.
      const engine = await hooks(running.app, 'enginePid')
      const budgets = [['main', metrics.find((m) => m.type === 'Browser')?.pid, 80], ['renderer', metrics.find((m) => m.type === 'Tab')?.pid, 250], ['engine', engine, 300]] as const
      for (const [label, pid, limit] of budgets) {
        const own = pid === undefined ? undefined : privateMemory(pid)
        console.log(`${label} private memory after scrolling: ${own === undefined ? 'not read' : `${own.toFixed(0)} MB`}, budget ${limit} MB`)
        if (own !== undefined) budget(reading(`${label} private memory after scrolling`, own, 'MB'), limit)
      }
      const page = await win.evaluate(() => ({ heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0, nodes: document.getElementsByTagName('*').length }))
      console.log(`renderer JS heap ${(page.heap / 1024 / 1024).toFixed(1)} MB, ${page.nodes} DOM elements`)
    } finally {
      await running.close()
    }
  })

  // Weekly on the laptop: two minutes of scrolling and 30 s of idle for one reading (performance.md 7.3).
  test('memory after heavy use: 20 topics, 50 tab switches, two minutes of mixed scrolling and the Juno panel', { tag: '@perf-weekly' }, async () => {
    test.setTimeout(900_000)
    const running = await launch(true)
    try {
      const juno = new Juno(running.app, running.win)
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      await expect.poll(() => hooks(running.app, 'agentState'), { timeout: 30_000 }).toBe('ready')
      await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
      await readMemory(running, 'memory after launch')
      if (process.env['JUNO_MEMORY_DUMP'] !== undefined) await memoryDump(running.win, `${process.env['JUNO_MEMORY_DUMP']}-launch-live.json`, false)
      const after = await heavyUse(juno, running)
      for (const [name, limit] of Object.entries(HEAVY_MEMORY_BUDGETS)) {
        const value = after[name as keyof typeof HEAVY_MEMORY_BUDGETS]
        if (value !== undefined) budget(reading(`${name} private memory after heavy use`, value, 'MB'), limit)
      }
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
      for (let i = 0; i < count(9, 12); i++) {
        const before = (await juno.measures('juno.all-topics-open')).length
        // The title bar's icon button: its centre, as Home's open presses.
        await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await press(win)
        await expect.poll(async () => (await juno.measures('juno.all-topics-open')).length).toBe(before + 1)
        await juno.tabs.close('All topics')
        await expect(juno.allTopics.table).toHaveCount(0)
      }
      const opens = (await juno.measures('juno.all-topics-open')).slice(2)
      const open = stats('All topics open, press to rows painted (juno.all-topics-open)', opens)
      budget(open, 50)

      await juno.allTopics.open()
      const table = juno.allTopics.table
      const total = Number(await table.getAttribute('aria-rowcount')) - 1
      console.log(`All topics rows: ${total}`)
      const tableBox = (await table.boundingBox())!
      await win.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2)
      await scrollReading(win, 'scroll-all-topics', { steps: count(40, 80), direction: 1, interval: await refreshInterval(win), layoutLimit: 256, placeholders: true, at: { x: tableBox.x + tableBox.width / 2, y: tableBox.y + tableBox.height / 2 } })
    } finally {
      await running.close()
    }
  })

  test('palette: ⌘K to recent rows, each keystroke to its rows, and every keystroke inside a frame', async () => {
    test.setTimeout(300_000)
    const running = await launch()
    try {
      const juno = new Juno(running.app, running.win)
      const { palette } = juno
      const { win } = running
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      const interval = await refreshInterval(win)
      const hidden = await countHidden(win)
      const keys: number[] = []
      const eventKeys: number[] = []
      const words = ['deplo', 'rollou', 'staging bil', 'index missin']
      const rounds = count(7, 12)
      for (let round = 0; round < rounds; round++) {
        const opened = (await juno.measures('juno.palette-open')).length
        await palette.open()
        await expect.poll(async () => (await juno.measures('juno.palette-open')).length).toBe(opened + 1)
        const typed = (await juno.measures('juno.palette-results')).length
        const text = words[round % words.length]!
        const reading = await typingReading(win, palette.input, `palette-keys-${round}`, () => palette.type(text))
        keys.push(...reading.presented)
        eventKeys.push(...reading.events)
        expect(reading.count).toBe(text.length)
        await expect(palette.input).toHaveValue(text)
        // Each keystroke ends its measure once its rows are painted; deferred renders may fold a fast run of keys into one.
        await expect.poll(async () => (await juno.measures('juno.palette-results')).length, { timeout: 10_000 }).toBeGreaterThan(typed)
        await win.waitForTimeout(150)
        await palette.press('Escape')
        await palette.expectClosed()
      }
      // The same words in a bare input, in the same run: the floor the palette is held to.
      const controlKeys: number[] = []
      for (let round = 0; round < rounds; round++) {
        const text = words[round % words.length]!
        const reading = await nativeControl(win, `palette-control-${round}`, (input) => input.pressSequentially(text))
        expect(reading.count).toBe(text.length)
        controlKeys.push(...reading.presented)
      }
      expect(await hidden(), 'palette lost focus or visibility').toBe(0)
      const open = stats('palette open, ⌘K to recent rows painted (juno.palette-open)', (await juno.measures('juno.palette-open')).slice(2))
      const results = stats('palette keystroke to its rows painted (juno.palette-results)', (await juno.measures('juno.palette-results')).slice(5))
      stats('palette Event Timing keydown/keypress >=16 ms (diagnostic)', eventKeys)
      const characters = stats('palette input timestamp to character presented', keys)
      const control = stats('bare input (control) input timestamp to character presented', controlKeys)
      budget(open, 50)
      budget(results, 100)
      budget(characters, characterBudget(control.p95, interval), { floor: interval })
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
      budget(perFrame, 8.3, { compare: 'p95', floor: 1 })
      if (absolute) expect(loaf).toBe(0)
      else budget(reading('sidebar drag: long animation frames', loaf, 'frames'), 0)
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
      const switcher = await juno.topic.openSwitcher()
      // When the topic's live queries answered, after the press: an engine wait shows here, renderer work does not.
      await running.win.evaluate(() => {
        const w = window as unknown as { __answers: Array<{ route: unknown; at: number; queryMs: unknown }> }
        w.__answers = []
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { detail?: { devtools?: { properties?: ReadonlyArray<readonly [string, unknown]> } } }>) {
            const properties = new Map(entry.detail?.devtools?.properties ?? [])
            if (entry.name === 'juno.live-update') w.__answers.push({ route: properties.get('route'), at: entry.startTime, queryMs: properties.get('queryMs') })
          }
        }).observe({ type: 'measure' })
      })
      // Not followed, so the boot never fetched its replies.
      const before = (await juno.measures('juno.topic-open')).length
      const measureOpen = async () => {
        await switcher.open('checkout.spec failed again')
        await expect.poll(async () => (await juno.measures('juno.topic-open')).length).toBeGreaterThan(before)
      }
      if (process.env['JUNO_PERF_TRACE'] !== undefined) await traced(running.win, `topic-open-uncached-${i}`, measureOpen)
      else await measureOpen()
      samples.push((await juno.measures('juno.topic-open')).at(-1)!)
      const answers = await running.win.evaluate(() => {
        const open = performance.getEntriesByName('juno.topic-open', 'measure').at(-1)!
        const w = window as unknown as { __answers: Array<{ route: unknown; at: number; queryMs: unknown }> }
        return w.__answers.filter((a) => a.at >= open.startTime - 50 && a.at <= open.startTime + open.duration).map((a) => `${String(a.route)} +${(a.at - open.startTime).toFixed(1)} (query ${String(a.queryMs)})`)
      })
      console.log(`topic open uncached ${i}: ${samples.at(-1)!.toFixed(1)} ms; answers ${answers.join(', ') || 'none in the measure'}`)
      await juno.topic.expectMessage('Can you add a wait')
    } finally {
      await running.close()
      await fake.close()
      await rm(dir, { recursive: true, force: true })
      await rm(appDir, { recursive: true, force: true })
    }
  }
  const open = stats('topic open, uncached, press to header and stored rows painted (juno.topic-open)', samples)
  budget(open, 50)
})

// The M4 gate (performance 3.4) on the topic300 seed: a 300-message thread
// and a 300-message Main, 20 % images, 15 % code blocks and 5 % tables, plus #perf-code
// (codeBlocksSeed: 50 distinct code blocks of 40 to 100 lines). One synced
// user-data directory; every scenario launches the app warm on it.
test.describe('topic view', () => {
  test.describe.configure({ mode: 'default' })
  let fake: FakeSlack
  let userData: string
  let slackDir: string
  let slackApp: SlackAppFixture
  const THREAD = 'Review the rollout checklist 1'
  const MAIN = '#perf-main'
  const CODE = '#perf-code'

  const launch = (agent = false): Promise<RunningApp> => launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent })

  /** Launches warm, waits for the sync, and closes any tab a previous launch left, which leaves one Home. With `agent`, Juno runs on a fake model. */
  async function ready(agent = false): Promise<{ readonly running: RunningApp; readonly juno: Juno }> {
    const running = await launch(agent)
    const juno = new Juno(running.app, running.win)
    await juno.sidebar.expectRows()
    await juno.expectEngineLive(120_000)
    for (let i = 0; i < 10 && !((await juno.tabs.root.getByRole('tab').count()) === 1 && (await juno.tabs.tab('Home').count()) === 1); i++) await juno.tabs.menu('close-tab')
    await juno.expectNothingOpen()
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

  /** Twenty switches between Main's tab and the thread's, timed with `juno.tab-switch`. */
  async function switchTabs(juno: Juno): Promise<number[]> {
    const samples: number[] = []
    for (let i = 0; i < count(8, 20); i++) {
      const before = (await juno.measures('juno.tab-switch')).length
      await juno.tabs.select(i % 2 === 0 ? 'perf-main' : THREAD)
      samples.push(await nextMeasure(juno, 'juno.tab-switch', before))
    }
    return samples
  }

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    fake = await startFakeSlack({
      seed: (workspace, avatars) => {
        topic300Seed({ tables: true })(workspace, avatars)
        codeBlocksSeed()(workspace, avatars)
      },
    })
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
      for (const title of [THREAD, MAIN, CODE]) {
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
      const rounds = count(4, 10)
      for (let i = 0; i < rounds; i++) {
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
        for (let i = 0; i < rounds; i++) {
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
      for (const title of absolute ? [THREAD, MAIN, THREAD, MAIN] : [THREAD, MAIN]) {
        const stop = await juno.topic.watchBottom()
        const before = (await juno.measures('juno.topic-open')).length
        await pressRow(juno, title)
        await nextMeasure(juno, 'juno.topic-open', before)
        await running.win.waitForTimeout(300)
        const distances = await stop()
        expect(distances.length).toBeGreaterThan(5)
        expect(Math.max(...distances)).toBeLessThanOrEqual(2)
      }
      // Rows have no hover controls: the message menu is one for the window, drawn on demand (performance.md 8).
      const dom = await running.win.evaluate(() => {
        const view = [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((node) => node.offsetParent !== null)
        return { rows: view?.querySelectorAll('[data-message-row]').length ?? 0, elements: view?.getElementsByTagName('*').length ?? 0 }
      })
      console.log(`topic open DOM: ${dom.rows} rows, ${dom.elements} elements`)
      const oneFrame = oneFrameBudget(await refreshInterval(running.win))
      budget(stats('topic open, cached 300 rows, press to rows painted at position (juno.topic-open)', cached), 50)
      budget(stats('topic open, prefetched (juno.topic-open)', prefetched), oneFrame)

      // Tab switch: two mounted tabs.
      await juno.sidebar.row(THREAD).openInNewTab()
      await juno.tabs.expectCount(2)
      let mounted: number[] = []
      await traced(running.win, 'tab-switch-mounted', async () => void (mounted = await switchTabs(juno)))
      budget(stats('tab switch, mounted (juno.tab-switch)', mounted), oneFrame)

      // The same with the thread's tab scrolled up: showing it again puts its held row back before paint.
      await juno.tabs.select(THREAD)
      await juno.topic.scrollUp(3000)
      const scrolledUp = await switchTabs(juno)
      budget(stats('tab switch, mounted, one tab scrolled up (juno.tab-switch)', scrolledUp), oneFrame)
    } finally {
      await running.close()
    }
  })

  // A topic that is mostly code, opened again once the colours of all its blocks are known. Only blocks near the
  // screen are painted (ADR 0017), so it keeps the cached open's budget.
  test('topic reopen: 50 code blocks whose colours are known', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    const shown = () => running.win.evaluate(() => {
      const view = [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((node) => node.offsetParent !== null)
      return { blocks: view?.querySelectorAll('pre').length ?? 0, painted: view?.querySelectorAll('[data-code-language]').length ?? 0 }
    })
    try {
      await juno.sidebar.row(CODE).open()
      await juno.topic.expectAtBottom()
      // Bring every block near the screen once, so the painter knows all their colours.
      await juno.topic.scroller.evaluate(async (scroller) => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        for (let top = scroller.scrollHeight; top > 0; top -= 400) {
          scroller.scrollTop = top
          await frame()
        }
        scroller.scrollTop = 0
        await frame()
      })
      await expect.poll(async () => (await shown()).painted, { timeout: 15_000 }).toBeGreaterThan(0)
      const samples: number[] = []
      const painted: number[] = []
      for (let i = 0; i < count(5, 10); i++) {
        for (const title of [THREAD, CODE]) {
          const before = (await juno.measures('juno.topic-open')).length
          await pressRow(juno, title)
          const ms = await nextMeasure(juno, 'juno.topic-open', before)
          if (title !== CODE) continue
          samples.push(ms)
          await expect.poll(async () => (await shown()).painted, { timeout: 5_000 }).toBeGreaterThan(0)
          painted.push((await shown()).painted)
        }
      }
      const { blocks } = await shown()
      console.log(`code topic reopen: ${blocks} blocks mounted, ${Math.min(...painted)} to ${Math.max(...painted)} painted`)
      expect(blocks).toBe(CODE_BLOCK_COUNT)
      expect(Math.max(...painted)).toBeLessThan(CODE_BLOCK_COUNT / 2)
      budget(stats('topic reopen, 50 code blocks with known colours, press to rows painted (juno.topic-open)', samples), 50)
    } finally {
      await running.close()
    }
  })

  // A scrollbar jump into the middle of #perf-code, opened cold: the rows it lands on have never been laid out (the
  // older half, above the last window's worth laid out at the end), and every one is a 40 to 100 line code block. Untimed against a budget of its own: the frames after the jump are
  // read against the scroll frame budget and the long-frame limit, and the row it landed on must not move.
  test('jump into the middle of 50 tall code blocks: the frames after it lands', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready()
    const { win } = running
    try {
      await juno.sidebar.row(CODE).open()
      await juno.topic.expectAtBottom()
      await win.waitForTimeout(500)
      await win.evaluate(() => {
        const longFrames: number[] = []
        new PerformanceObserver((list) => longFrames.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'long-animation-frame' })
        Object.assign(window, { junoLongFrames: longFrames })
      })
      // The 13th of the 50 rows at the top of the view.
      const { fraction, skipped } = await juno.topic.scroller.evaluate((scroller) => {
        const row = scroller.querySelectorAll<HTMLElement>('[data-message-row]')[12]!
        const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        return { fraction: top / (scroller.scrollHeight - scroller.clientHeight), skipped: row.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) === false }
      })
      expect(skipped, 'the row the jump lands on was never laid out').toBe(true)
      let landing: Landing | undefined
      const { work } = await traced(win, 'code-jump', async () => {
        landing = await juno.topic.jumpTo(fraction, 30)
        await win.waitForTimeout(300)
      })
      const longFrames = await win.evaluate(() => (window as unknown as { junoLongFrames: number[] }).junoLongFrames)
      const moved = Math.max(...landing!.tops.map((top) => Math.abs(top - landing!.top)))
      const heaviest = [...work].toSorted((a, b) => b - a).slice(0, 3)
      console.log(`code jump: heaviest frames ${heaviest.map((ms) => ms.toFixed(1)).join(' ')} ms (scroll budget 8.3), long animation frames ${longFrames.map((ms) => ms.toFixed(0)).join(' ') || 'none'}, landed row moved ${moved.toFixed(1)} px, load ${loadavg()[0]!.toFixed(1)}`)
      expect(moved, 'the row the jump landed on moves').toBeLessThan(0.5)
      if (absolute) expect.soft(longFrames, 'long animation frames after the jump').toEqual([])
      else budget(reading('code jump: long animation frames after the jump', longFrames.length, 'frames'), 0)
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
        for (let i = 0; i < count(4, 10); i++) {
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
      budget(stats('peek open, key down to the peeked rows painted (juno.peek-open)', samples), oneFrameBudget(await refreshInterval(running.win)))
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
      await scrollReading(win, 'scroll-messages', { steps: 30, direction: 1, interval: await refreshInterval(win), layoutLimit: 2000, at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } })
    } finally {
      await running.close()
    }
  })

  test('drag a selection down the 300-message thread with the Juno panel open, while its chip follows', async () => {
    test.setTimeout(300_000)
    const { running, juno } = await ready(true)
    const { win } = running
    try {
      await expect.poll(() => hooks(running.app, 'agentState'), { timeout: 30_000 }).toBe('ready')
      await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
      await juno.sidebar.row(THREAD).open()
      await juno.topic.expectAtBottom()
      const interval = await refreshInterval(win)
      // Each drag starts three screens up, so it has rows below to cross.
      const upFromBottom = async () => {
        await juno.topic.scroller.evaluate((list) => list.scrollTo({ top: list.scrollHeight - list.clientHeight - 2_400, behavior: 'instant' }))
        await win.waitForTimeout(500)
      }
      // The same drag with the panel closed: what the selection itself costs, for comparison on the Mac.
      if (absolute) {
        await upFromBottom()
        await selectionDragReading(win, juno.topic.scroller, 'select-drag-no-panel', interval)
        await win.evaluate(() => document.getSelection()?.removeAllRanges())
      }
      await juno.tabs.menu('juno')
      await expect(win.locator('aside[data-juno-panel]')).toBeVisible()
      await upFromBottom()
      const panel = await selectionDragReading(win, juno.topic.scroller, 'select-drag-panel', interval)
      await expect(win.locator('[data-panel-selection]')).toHaveText(/^\d+ messages: “/)
      budget(stats('selection drag with the panel open, frame work', panel.work), 8.3, { compare: 'p95', floor: 1 })
      if (absolute) expect.soft(panel.loaf, 'long animation frames while dragging a selection').toBe(0)
      else budget(reading('selection drag with the panel open: long animation frames', panel.loaf, 'frames'), 0)
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
      budget(stats('tab switch, unmounted with scroll restore (juno.tab-switch)', samples), 50)
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
        for (let i = 0; i < count(7, 9); i++) {
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
      budget(stats('live update in the topic, engine commit to pixels (juno.live-update, messages.list)', measured), 50)
    } finally {
      await running.close()
    }
  })
})

test.describe('Juno chat', () => {
  test.describe.configure({ mode: 'default' })
  let fake: FakeSlack
  let model: FakeOpenRouter
  let userData: string
  let slackDir: string
  let slackApp: SlackAppFixture

  const launch = (): Promise<RunningApp> =>
    launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })

  test.beforeAll(async () => {
    fake = await startFakeSlack()
    // Three bubbles per answer, so the scroll scenario has rows of every kind.
    model = await startFakeOpenRouter({ answer: (request) => `${answer(request)}<say>A second line about it.</say><say>And a third, longer one, so the bubble wraps onto two lines in the 720px column of the Juno tab.</say>` })
    userData = await tempUserData()
    slackDir = await tempUserData()
    slackApp = await writeSlackApp(fake, slackDir)
  })

  test.afterAll(async () => {
    await fake?.close()
    await model?.close()
    await rm(userData, { recursive: true, force: true })
    await rm(slackDir, { recursive: true, force: true })
  })

  test('send to your bubble and to the first answer, ⌘J to the panel, and scroll the chat', async () => {
    test.setTimeout(600_000)
    const running = await launch()
    const { win } = running
    const juno = new Juno(running.app, win)
    try {
      await juno.signIn()
      await juno.sidebar.expectRows()
      await juno.expectEngineLive(120_000)
      await expect.poll(() => hooks(running.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
      await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
      const composer = win.locator('main [data-juno-chat] textarea')
      await composer.waitFor()

      const sends: number[] = []
      const bubbles: number[] = []
      for (let i = 0; i < count(20, 80); i++) {
        const before = { send: (await juno.measures('juno.chat-send')).length, bubble: (await juno.measures('juno.chat-bubble')).length }
        await composer.fill(`message ${i}`)
        await composer.press('Enter')
        await expect.poll(async () => (await juno.measures('juno.chat-bubble')).length, { timeout: 15_000 }).toBeGreaterThan(before.bubble)
        sends.push((await juno.measures('juno.chat-send')).at(-1)!)
        bubbles.push((await juno.measures('juno.chat-bubble')).at(-1)!)
      }
      const oneFrame = oneFrameBudget(await refreshInterval(win))
      budget(stats('chat send, Enter to your bubble painted (juno.chat-send)', sends), oneFrame)
      budget(stats('chat first bubble, Enter to Juno\'s bubble painted, fake model (juno.chat-bubble)', bubbles), 2500)

      // Scroll the 400-row chat, as the topic view's scenario does.
      const scroller = win.locator('main [data-juno-chat] [data-scroll]')
      const box = (await scroller.boundingBox())!
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await scrollReading(win, 'scroll-chat', { steps: 30, direction: -1, interval: await refreshInterval(win), layoutLimit: 2000, at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } })

      // ⌘J beside a topic: the panel painted with its composer.
      await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
      await juno.sidebar.row(POSTGRES).open()
      await juno.topic.expectAtBottom()
      const panels = await panelOpens(juno, win)
      console.log(`panel open, in order: ${panels.map((ms) => ms.toFixed(1)).join(' ')}`)
      budget(stats('panel open, ⌘J to the panel painted (juno.panel-open)', panels), oneFrame)

      // The panel's switcher to Activity, its window the newest 50 of the 80 runs above, and back.
      const switches = await pageSwitches(juno, win)
      budget(stats('switch to Activity in the panel, pick to the page painted (juno.page-switch)', switches), 50)
    } finally {
      await running.close()
    }
  })
})

// The topic composer's mention typing scenario in the Juno tab's composer (performance.md 7.1), on its
// own fake Slack, model and user data.
test('Juno mention typing: each keystroke of "@ma" to its character presented', async () => {
  test.setTimeout(240_000)
  const fake = await startFakeSlack()
  const model = await startFakeOpenRouter({ answer })
  const userData = await tempUserData()
  const slackDir = await tempUserData()
  const slackApp = await writeSlackApp(fake, slackDir)
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
  try {
    await junoMentionTyping(running)
  } finally {
    await running.close()
    await Promise.all([fake.close(), model.close(), rm(userData, { recursive: true, force: true }), rm(slackDir, { recursive: true, force: true })])
  }
})

/**
 * "@ma " ten times in the Juno tab's composer, as the topic composer's mention typing scenario types
 * it: each input to its character presented, soft against a bare input in the same run.
 */
async function junoMentionTyping(running: RunningApp): Promise<void> {
  const { win } = running
  const juno = new Juno(running.app, win)
  await juno.signIn()
  await juno.sidebar.expectRows()
  await expect.poll(() => hooks(running.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const input = win.locator('main [data-juno-chat] textarea').filter({ visible: true })
  await input.waitFor()
  const hidden = await countHidden(win)
  const interval = await refreshInterval(win)
  const times = count(4, 10)
  const rounds = (field: Locator) => async () => {
    for (let round = 0; round < times; round++) {
      await field.pressSequentially('@ma ')
      await win.waitForTimeout(150)
    }
  }
  const control = stats('Juno mention typing, bare input (control) input timestamp to character presented', (await nativeControl(win, 'typing-juno-mention-control', (field) => rounds(field)())).presented)
  const limit = characterBudget(control.p95, interval)
  await input.fill('')
  await input.focus()
  const result = await typingReading(win, input, 'typing-juno-mention', rounds(input))
  expect(result.count).toBe(times * 4)
  await expect(input).toHaveValue('@ma '.repeat(times))
  expect(await hidden(), 'the window was hidden or covered while measuring, so its frames were not drawn').toBe(0)
  stats('Juno mention typing, Event Timing keydown/keypress >=16 ms (diagnostic)', result.events)
  const presented = stats('Juno mention typing, input timestamp to character presented', result.presented)
  stats('Juno mention typing, input to animation frame callback', result.frame)
  stats('Juno mention typing, animation frame callback to presentation', result.afterFrame)
  budget(presented, limit, { floor: interval })
}

/** The panel's switcher to Activity and back to the chat, twenty times: each `juno.page-switch`, in order. */
async function pageSwitches(juno: Juno, win: Page): Promise<number[]> {
  const pick = async (label: string) => {
    await win.locator('aside[data-juno-panel] [data-juno-header] button[aria-haspopup="menu"]').click()
    await win.getByRole('menu', { name: 'Juno pages' }).getByRole('menuitem', { name: label, exact: true }).click()
  }
  await juno.tabs.menu('juno')
  const switches: number[] = []
  for (let i = 0; i < count(8, 20); i++) {
    const before = (await juno.measures('juno.page-switch')).length
    await pick('Activity')
    await expect.poll(async () => (await juno.measures('juno.page-switch')).length, { timeout: 15_000 }).toBeGreaterThan(before)
    switches.push((await juno.measures('juno.page-switch')).at(-1)!)
    await pick('Chat')
    await expect(win.locator('aside[data-juno-panel] [data-juno-chat]')).toBeVisible()
  }
  return switches
}

/** ⌘J twenty times beside the open topic: each `juno.panel-open`, in order. With JUNO_PERF_TRACE, the first two are traced. */
async function panelOpens(juno: Juno, win: Page): Promise<number[]> {
  const panels: number[] = []
  for (let i = 0; i < count(8, 20); i++) {
    const before = (await juno.measures('juno.panel-open')).length
    const open = async () => {
      await juno.tabs.menu('juno')
      await expect.poll(async () => (await juno.measures('juno.panel-open')).length, { timeout: 15_000 }).toBeGreaterThan(before)
    }
    // The first open mounts the panel for the first time; the second is a usual one to compare it with.
    if (process.env['JUNO_PERF_TRACE'] !== undefined && i < 2) await traced(win, `panel-open-${i}`, open)
    else await open()
    panels.push((await juno.measures('juno.panel-open')).at(-1)!)
    await juno.tabs.menu('juno')
    await expect(win.locator('aside[data-juno-panel]')).toHaveCount(0)
  }
  return panels
}

defaultSeedTest('a new tab with Home open to its composer painted', async ({ juno, win }) => {
  await signedIn(juno)
  const samples: number[] = []
  for (let i = 0; i < count(8, 20); i++) {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await win.evaluate(() => {
      const button = document.querySelector('[aria-label="New tab ⌘T"]')
      if (!button) throw new Error('New tab button missing')
      button.addEventListener('click', () => {
        performance.mark('home-open-start')
        const observer = new MutationObserver(() => {
          if (![...document.querySelectorAll('[data-home] [data-composer-field]')].some(node => node.getClientRects().length > 0)) return
          observer.disconnect()
          requestAnimationFrame(() => setTimeout(() => performance.measure('home-open', 'home-open-start'), 0))
        })
        observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      }, { once: true })
    })
    await juno.tabs.newTabButton.hover()
    await press(win)
    await expect(juno.write.field).toBeVisible()
    await expect.poll(() => win.evaluate(() => performance.getEntriesByName('home-open').length)).toBe(i + 1)
    samples.push(await win.evaluate(() => performance.getEntriesByName('home-open').at(-1)!.duration))
  }
  // One frame, as New chat open was: the new tab and its focused composer are the next frame (docs/performance.md section 1).
  budget(stats('New tab with Home to its composer', samples), oneFrameBudget(await refreshInterval(win)))
})

test('quick start: first sign-in to sidebar rows on the large seed, 300 ms per call, production pacing', async () => {
  test.setTimeout(300_000)
  const samples: number[] = []
  // Paced calls make it steady (2,793 to 2,806 ms over three on 10-18): one run on the laptop.
  for (let i = 0; i < count(1, 3); i++) {
    const fake = await startFakeSlack({ seed: largeSeed(), latencyMillis: 300 })
    const userData = await tempUserData()
    const slackDir = await tempUserData()
    try {
      const slackApp = await writeSlackApp(fake, slackDir)
      const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, paced: true })
      try {
        const juno = new Juno(running.app, running.win)
        await juno.signIn({ skipSetUp: false })
        const signedIn = Date.now()
        await juno.skipSetUp()
        await expect(juno.sidebar.rows.first()).toBeVisible({ timeout: 60_000 })
        samples.push(Date.now() - signedIn)
      } finally {
        await running.close()
      }
    } finally {
      await fake.close()
      await rm(userData, { recursive: true, force: true })
      await rm(slackDir, { recursive: true, force: true })
    }
  }
  budget(stats('quick start, sign-in to sidebar rows', samples), 5_000, { floor: 300 })
})


function coldEmojiOpen(win: Page) {
  return win.evaluate(() => new Promise<{ duration: number; started: number; clicked: number }>((resolve, reject) => {
    const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('Settings Add reaction did not appear')) }, 5000)
    const observer = new MutationObserver(() => {
      const add = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Add reaction' && button.getClientRects().length > 0)
      if (add === undefined) return
      observer.disconnect()
      requestAnimationFrame(() => setTimeout(() => {
        const clicked = performance.now()
        if (performance.getEntriesByName('juno.emoji-ready').length > 0) { reject(new Error('Emoji subscription warmed before the cold open')); return }
        const subscribed = performance.getEntriesByName('juno.emoji-subscribe')[0]?.startTime
        const started = Math.min(clicked, subscribed ?? clicked)
        add.click()
        void window.__emojiBenchmarkReleaseImages()
        const tick = () => {
          const picker = document.querySelector('[data-emoji-picker]')
          if (performance.now() - started > 5000) { reject(new Error(`Cold picker did not load its visible images: ${picker?.textContent}`)); return }
          const images = Array.from(picker?.querySelectorAll('img') ?? [])
          if (images.length >= 6 && images.every((image) => image.complete && image.naturalWidth > 0)) setTimeout(() => { clearTimeout(deadline); const end = performance.now(); performance.measure('juno.emoji-cold-open', { start: started, end }); resolve({ duration: end - started, started, clicked }) }, 0)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }, 0))
    })
    observer.observe(document.body, { subtree: true, childList: true })
  }))
}

test('emoji picker with 20,000 workspace emoji, cold subscription and loaded images', async ({ juno, fake, running, userData, slackApp }) => {
  test.setTimeout(240_000)
  const images = [...fake.workspace.emoji.values()].flatMap((emoji) => typeof emoji.value === 'string' && !emoji.value.startsWith('alias:') ? [emoji.value] : [])
  const custom = Array.from({ length: 20_000 - images.length }, (_, i) => ({ name: `perf_emoji_${String(i).padStart(5, '0')}`, url: `${images[i % images.length]}?emoji=${i}` }))
  for (const emoji of custom) fake.addEmoji(emoji)
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare('INSERT INTO prefs (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run('quickReactions', JSON.stringify(custom.slice(0, 6).map((emoji) => ({ ...emoji, unicode: `:${emoji.name}:` }))))
  db.close()
  const samples: number[] = []
  const preloadWork: number[] = []
  for (let i = 0; i < count(3, 10); i++) {
    // The Mac's own load; the laptop's job has its cores, and its host's load is other projects'.
    if (absolute) await expect.poll(() => loadavg()[0], { timeout: 120_000, intervals: [1000] }).toBeLessThanOrEqual(8)
    const app = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    try {
      const second = new Juno(app.app, app.win)
      await second.waitForSync()
      // Let process startup settle; Home must still have no emoji subscription.
      await app.win.waitForTimeout(500)
      fake.holdEmojiImages()
      await app.win.exposeFunction('__emojiBenchmarkReleaseImages', () => fake.releaseEmojiImages())
      const cdp = await app.win.context().newCDPSession(app.win)
      await cdp.send('Network.clearBrowserCache')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      const requestedImages = new Set<string>()
      app.win.on('request', (request) => { if (request.url().includes('/emoji/')) requestedImages.add(request.url()) })
      expect(await app.win.evaluate(() => performance.getEntriesByName('juno.emoji-subscribe').length), 'a new renderer must have no warm emoji subscription').toBe(0)
      // Click just after Settings first paints, while its workspace query is still cold.
      // Include the entire subscription if idle preload started it before that click.
      const reading = coldEmojiOpen(app.win)
      const open = async () => { await second.openSettings('Appearance'); await reading }
      if (i === 0 && process.env.JUNO_PERF_TRACE !== undefined) await traced(app.win, 'emoji-cold-open', open)
      else await open()
      const measured = await reading
      const subscription = await app.win.evaluate(() => ({ start: performance.getEntriesByName('juno.emoji-subscribe')[0]!.startTime, duration: performance.getEntriesByName('juno.emoji-ready')[0]!.duration, resolve: performance.getEntriesByName('juno.emoji-resolve', 'measure')[0]!.duration, prepare: performance.getEntriesByName('juno.emoji-prepare', 'measure')[0]!.duration, decode: performance.getEntriesByName('juno.emoji-decode', 'measure')[0]!.duration, catalog: performance.getEntriesByName('juno.emoji-catalog', 'measure')[0]!.duration }))
      expect(subscription.start, 'subscription starts inside the timed cold open').toBeGreaterThanOrEqual(measured.started)
      expect(requestedImages.size, 'visible images fetched in this fresh renderer').toBeGreaterThanOrEqual(6)
      samples.push(measured.duration)
      preloadWork.push(subscription.decode + subscription.resolve + subscription.prepare + subscription.catalog)
      console.log(`cold emoji open ${i + 1}: ${measured.duration.toFixed(1)} ms, subscription and preparation ${subscription.duration.toFixed(1)} ms (decode ${subscription.decode.toFixed(1)}, resolve ${subscription.resolve.toFixed(1)}, prepare ${subscription.prepare.toFixed(1)}, catalog ${subscription.catalog.toFixed(1)})`)
      const picker = app.win.getByRole('dialog', { name: 'Emoji' })
      expect(await picker.locator('[data-emoji]').count()).toBeLessThan(200)
      if (i === 0) {
        await picker.getByRole('group', { name: 'Workspace', exact: true }).evaluate((node) => node.scrollIntoView({ block: 'start' }))
        await expect(picker.locator('[data-emoji="juno_check"]')).toBeVisible()
        await picker.getByRole('textbox').fill('perf_emoji_')
        await expect(picker.locator('[data-emoji="perf_emoji_00000"]')).toBeVisible()
        await picker.getByRole('textbox').press('ArrowDown')
        await picker.locator('[data-scroll-area]').hover()
        await app.win.mouse.wheel(0, 4000)
        await expect.poll(() => picker.locator('[data-scroll-area]').evaluate((node) => node.scrollTop)).toBeGreaterThan(1000)
        await app.win.keyboard.press('ArrowRight')
        await expect(picker.locator('[data-emoji="perf_emoji_00001"]')).toBeFocused()
        await picker.getByRole('textbox').fill('perf_emoji_19991')
        await expect(picker.locator('[data-emoji="perf_emoji_19991"]')).toBeVisible()
      }
      await app.win.keyboard.press('Escape')
      await second.home.open()
      await expect.poll(() => { const tabs = savedTabs(userData, fake.teamId); return tabs?.tabs[tabs.active]?.place }).toBe('home')
      await cdp.detach()
    } finally {
      fake.releaseEmojiImages()
      await app.close()
    }
  }
  const timing = stats('20,000 distinct workspace URLs, cold subscription, click to loaded visible images', samples)
  stats('emoji preload synchronous renderer work (decode, resolve and catalog preparation)', preloadWork)
  budget(timing, 50)
})

// Trace the idle preload without ever opening a picker: scripts/perf-trace.mjs
// sums main-thread work, including module evaluation, inside juno.emoji-preload.
test('20,000 workspace emoji preload after first paint', { tag: '@perf-weekly' }, async ({ juno, fake, running, userData, slackApp }) => {
  test.setTimeout(120_000)
  for (let i = 0; i < 20_000; i++) fake.addEmoji({ name: `preload_${i}`, url: `${fake.url}/emoji/juno_wave.svg?emoji=${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const app = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const second = new Juno(app.app, app.win)
    await second.waitForSync()
    expect(await app.win.evaluate(() => performance.getEntriesByName('juno.emoji-subscribe').length)).toBe(0)
    await recordTrace(app.win, 'emoji-preload', async () => {
      await second.sidebar.row('#eng').open()
      await expect.poll(() => app.win.evaluate(() => performance.getEntriesByName('juno.emoji-preload', 'measure').length)).toBe(1)
    })
    const timing = await app.win.evaluate(() => {
      const preload = performance.getEntriesByName('juno.emoji-preload', 'measure')[0]!
      const topic = performance.getEntriesByName('juno.topic-open', 'measure').at(-1)!
      const ready = performance.getEntriesByName('juno.emoji-ready', 'measure')[0] as PerformanceMeasure
      const detail = ready.detail as { devtools: { properties: Array<[string, unknown]> } }
      return { preload: preload.duration, start: preload.startTime, painted: topic.startTime + topic.duration, count: detail.devtools.properties.find(([key]) => key === 'emojiCount')?.[1] }
    })
    expect(timing.start, 'preload begins after the topic first paints').toBeGreaterThanOrEqual(timing.painted)
    expect(timing.count).toBeGreaterThanOrEqual(20_000)
    await expect(app.win.getByRole('dialog', { name: 'Emoji' })).toHaveCount(0)
    console.log(`20,000 emoji idle preload: ${timing.preload.toFixed(1)} ms elapsed; inspect juno.emoji-preload for main-thread cost`)
  } finally {
    await app.close()
  }
})
