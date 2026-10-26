// Counted layout budgets (docs/performance.md, "Counted budgets"): Chromium's own counters of layouts
// and style recalculations (CDP `Performance.getMetrics`: LayoutCount, RecalcStyleCount) and the DOM
// mutations, for scrolling a long message list a fixed step at a time and for typing in the composer.
// A forced layout in a scroll handler, a style written on every row per frame, or a keystroke that
// re-renders the list each add layouts or mutations, and the count fails on any machine and load.
// Each scroll step moves the list programmatically by the same distance and waits until it has drawn,
// every picture in view has loaded and the page is idle, after a first pass over the same rows, so the
// counts do not depend on frame timing: layouts and mutations are the same in every run, style
// recalculations within one. Work that comes by timing stays out: counting starts once Slack shows the user
// active, which the shell's 10 s activity poll sets off (the test polls at once), and mutations are counted in the open topic only,
// not in the sidebar, whose sync cycles mark it busy on their own schedule. Budgets are today's counts plus a
// little headroom; a failure prints the counts and the mutations.
import type { CDPSession, Page } from '@playwright/test'
import { expectWork } from '@juno/testing/work-budget'
import { expect } from './fixtures'
import { frames, longTest, openFullWindow } from './stickBottomLists'

const STEPS = 12
const STEP_PX = 180

interface Counted {
  readonly layouts: number
  readonly styles: number
  readonly mutations: number
}

async function metrics(cdp: CDPSession, win: Page): Promise<Counted> {
  const { metrics: all } = await cdp.send('Performance.getMetrics')
  const value = (name: string) => all.find((metric) => metric.name === name)?.value ?? 0
  const mutations = await win.evaluate(() => (window as unknown as { __countedMutations: string[] }).__countedMutations.length)
  return { layouts: value('LayoutCount'), styles: value('RecalcStyleCount'), mutations }
}

const since = (after: Counted, before: Counted): Counted => ({ layouts: after.layouts - before.layouts, styles: after.styles - before.styles, mutations: after.mutations - before.mutations })

/** The mutations since `before`, by kind and target, for a failure's message. */
const mutationsSince = (win: Page, before: Counted) =>
  win.evaluate((from) => (window as unknown as { __countedMutations: string[] }).__countedMutations.slice(from).join('\n'), before.mutations)

/** Two frames drawn, every picture in view loaded, the page idle, two more frames. */
async function drawn(win: Page): Promise<void> {
  await frames(win, 2)
  await win.waitForFunction(() => [...document.querySelectorAll('[data-topic-view] img')].every((img) => {
    const box = img.getBoundingClientRect()
    return box.bottom < 0 || box.top > innerHeight || (img as HTMLImageElement).complete
  }))
  await win.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 500 })))
  await frames(win, 2)
}

longTest('scrolling a long message list and typing in its composer stay within their counted layouts', async ({ juno, win }) => {
  await openFullWindow(juno, 'Review the rollout checklist 1')
  await expect(juno.sidebar.accountButton.locator('[data-presence="active"]')).toHaveCount(1)
  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Performance.enable')
  await juno.topic.root.evaluate((view) => {
    const state = window as unknown as { __countedMutations: string[] }
    state.__countedMutations = []
    const named = (node: Node) => node instanceof Element
      ? `${node.tagName.toLowerCase()}${[...node.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}='${a.value.slice(0, 40)}']`).join('')}`
      : node.nodeName
    new MutationObserver((records) => {
      for (const record of records) state.__countedMutations.push(`${record.type}${record.attributeName === null ? '' : ` ${record.attributeName}`} on ${named(record.target)}`)
    }).observe(view, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  const scroller = juno.topic.scroller
  await drawn(win)

  await longTest.step(`scrolling up ${STEPS} steps of ${STEP_PX} px, one at a time`, async () => {
    // A first pass over the same rows loads their pictures and lets each row keep its drawn size, so the
    // counted pass does not depend on when bytes arrive.
    for (const by of [STEP_PX, -STEP_PX]) {
      for (let step = 0; step < STEPS; step++) {
        await scroller.evaluate((node, distance) => { node.scrollTop -= distance }, by)
        await drawn(win)
      }
    }
    const before = await metrics(cdp, win)
    for (let step = 0; step < STEPS; step++) {
      await scroller.evaluate((node, distance) => { node.scrollTop -= distance }, STEP_PX)
      await drawn(win)
    }
    const work = since(await metrics(cdp, win), before)
    expectWork('scroll', { ...work }, { layouts: 8, styles: 36, mutations: 3 }, await mutationsSince(win, before))
  })

  await longTest.step('typing twenty-one characters in the composer', async () => {
    await juno.topic.composer.click()
    await drawn(win)
    const before = await metrics(cdp, win)
    for (const key of 'counting each key now') {
      await win.keyboard.type(key)
      await frames(win, 2)
    }
    await expect(juno.topic.composer).toHaveValue('counting each key now')
    const work = since(await metrics(cdp, win), before)
    expectWork('typing', { ...work }, { layouts: 49, styles: 28, mutations: 50 }, await mutationsSince(win, before))
  })
})
