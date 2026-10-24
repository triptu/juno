// Opening topics Juno holds, from the press to the first frame that shows their rows (performance.md 1, topic
// open cached: 50 ms), with Slack answering in 150 ms as it does from a laptop: Main and a short thread from the
// sidebar, a 600-reply thread opened again, and a link to a reply in it Juno holds, timed from the click, as links
// open. `juno.topic-open` ends on the first frame with the header in place, so it cannot see a list held back for
// Slack; this probe looks at the rows themselves.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { press, type Juno } from './driver/juno'
import { stats } from './perfStats'

test.skip(process.env.JUNO_PERF !== '1', 'set JUNO_PERF=1 to measure')

const CACHED_BUDGET = 50
const POSTGRES = 'Draft plan is in the doc'
const ENG = '#eng'
const LONG = 'Long rollout log for perf'
const ROWS = '[data-topic-view] [data-message-row]'

/**
 * From the next `pointerdown` (a sidebar row opens on it) or `click` (a link in a message opens on it) to the first
 * frame that draws a row `selector` matches in a shown topic.
 */
async function rowsAfterPress(win: Page, act: () => Promise<void>, selector = ROWS, on: 'pointerdown' | 'click' = 'pointerdown'): Promise<number> {
  await win.evaluate(({ selector, on }) => {
    const w = window as unknown as { __rows?: Promise<number> }
    w.__rows = new Promise((resolve) => {
      addEventListener(on, (event) => {
        const start = event.timeStamp
        const shown = () => [...document.querySelectorAll<HTMLElement>(selector)].some((row) => row.offsetParent !== null && row.getBoundingClientRect().height > 0)
        const frame = (at: number) => (shown() ? resolve(at - start) : requestAnimationFrame(frame))
        requestAnimationFrame(frame)
      }, { capture: true, once: true })
    })
  }, { selector, on })
  await act()
  return win.evaluate(() => (window as unknown as { __rows: Promise<number> }).__rows)
}

async function pressAt(juno: Juno, box: { x: number; y: number; width: number; height: number }) {
  await juno.win.mouse.move(box.x + Math.min(40, box.width / 2), box.y + box.height / 2, { steps: 1 })
  await press(juno.win)
}

test('topic reopen: Main, a thread and a 600-reply thread from the sidebar, and a link to a reply, to rows painted', async ({ juno, fake }) => {
  test.setTimeout(600_000)
  await juno.signIn()
  await juno.waitForSync()
  // After every message the sync stored, so the root is the newest in Main.
  const start = fake.advanceClock({ millis: 5 * 60_000 }) - 60_000
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: LONG, at: start, silent: true })
  const replies = Array.from({ length: 600 - 1 }, (_, i) =>
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${i + 1}`, threadTs: root.ts, at: start + (i + 1) * 50, silent: true }))
  // The last one live: Juno looks the root up, with its counts, as it does for a reply to a thread it lacks.
  replies.push(fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${600}`, threadTs: root.ts }))
  // Main's open stores the root with its counts before the follow arrives.
  await juno.sidebar.row(ENG).open()
  await juno.topic.expectMessage(LONG)
  // Off the sidebar, which holds its order under the pointer (SPEC 5), so the thread's new row can come in.
  await juno.win.mouse.move(700, 400)
  fake.markThreadRead({ channel: 'C0ENG', threadTs: root.ts, ts: replies[589]!.ts })
  fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
  const link = `${fake.url}/archives/C0ENG/p${replies[299]!.ts.replace('.', '')}?thread_ts=${root.ts}&cid=C0ENG`
  fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: `Look at <${link}|the middle step>` })
  await juno.sidebar.row(LONG).expectVisible()
  // Each read once, so every open below is of a topic Juno holds.
  for (const title of [ENG, POSTGRES, LONG]) {
    await juno.sidebar.row(title).open()
    await expect(juno.topic.list.locator('[data-message-row]').first()).toBeVisible({ timeout: 15_000 })
    await juno.sidebar.row(title).expectRead()
  }
  // The link's reply once, so Juno holds it.
  await juno.sidebar.row(ENG).open()
  await juno.topic.message('Look at the middle step').getByRole('link', { name: 'the middle step' }).click()
  await juno.topic.expectMessage('rollout step 300')
  await juno.tabs.close(LONG)
  fake.setLatency({ ms: 150 })

  const samples = new Map<string, number[]>()
  const add = (name: string, ms: number) => samples.set(name, [...(samples.get(name) ?? []), ms])
  for (let i = 0; i < 10; i++) {
    for (const title of [ENG, POSTGRES, LONG]) {
      // From Home, so each open is fresh.
      await juno.home.open()
      const box = (await juno.sidebar.row(title).root.boundingBox())!
      add(title, await rowsAfterPress(juno.win, () => pressAt(juno, box)))
      await juno.topic.expectAtBottom()
    }
    await juno.sidebar.row(ENG).open()
    const anchor = juno.topic.message('Look at the middle step').getByRole('link', { name: 'the middle step' })
    const box = (await anchor.boundingBox())!
    add('link', await rowsAfterPress(juno.win, () => pressAt(juno, box), `[data-topic-view] [data-message-row="${replies[299]!.ts}"]`, 'click'))
    await juno.topic.expectMessage('rollout step 300')
    await juno.tabs.close(LONG)
    await expect(juno.topic.message('Look at the middle step')).toBeVisible()
  }
  for (const [name, values] of samples) {
    const result = stats(`topic reopen, ${name}, press to rows painted`, values)
    expect.soft(result.p95, `${name} p95 ${result.p95.toFixed(1)} ms`).toBeLessThanOrEqual(CACHED_BUDGET)
  }
})
