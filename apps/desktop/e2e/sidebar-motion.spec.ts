// Rows moving at the top of the sidebar (SPEC 5, "Holding the order"): a
// change from elsewhere slides the rows to their new places while the list
// is at its top, a row can be pressed while it slides, reduced motion puts
// the rows in place at once, and your own Resolve takes its row out in one
// frame with no motion.
import type { Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 90_000 })

const ROW = '[role="group"][aria-label="Topics"] [data-topic-row]'

function recentIds(juno: Juno): Promise<string[]> {
  return juno.sidebar.section('Recent').locator('[data-topic-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-topic-id') ?? ''))
}

/** A thread in view a few rows down, which a reply moves to the top. */
async function threadInView(juno: Juno): Promise<string> {
  const mover = (await recentIds(juno)).slice(3, 8).find((id) => id.startsWith('t:'))
  expect(mover).toBeDefined()
  return mover!
}

function replyIn(fake: { injectMessage: (input: { channel: string; threadTs: string; user: string; text: string }) => unknown }, id: string, text: string): void {
  const [, channel, threadTs] = id.split(':')
  fake.injectMessage({ channel: channel!, threadTs: threadTs!, user: 'U0LEO', text })
}

/** The pointer away from the list, at its top, with the motion loaded: it loads when the browser is idle after the first rows, within 2 s. */
async function atTheTop(juno: Juno, win: Page): Promise<void> {
  await juno.sidebar.leave()
  await expect.poll(() => win.evaluate(() => performance.getEntriesByType('resource').some((entry) => /\/sidebarMoves-[^/]+\.js$/.test(new URL(entry.name).pathname)))).toBe(true)
  await expect.poll(() => juno.sidebar.list.evaluate((list) => list.scrollTop)).toBe(0)
}

interface Frame {
  readonly order: ReadonlyArray<string>
  readonly tops: Readonly<Record<string, number>>
  readonly animating: number
}

/** Records, every frame until `stop`, the rows' order and drawn tops and how many of them animate. */
async function recordFrames(win: Page): Promise<void> {
  await win.evaluate((selector) => {
    const frames: Frame[] = []
    const store = globalThis as { __rowFrames?: Frame[]; __rowFramesStop?: boolean }
    store.__rowFrames = frames
    store.__rowFramesStop = false
    const tick = () => {
      const rows = [...document.querySelectorAll<HTMLElement>(selector)].slice(0, 12)
      frames.push({
        order: rows.map((row) => row.dataset['topicId'] ?? ''),
        tops: Object.fromEntries(rows.map((row) => [row.dataset['topicId'] ?? '', row.getBoundingClientRect().top])),
        animating: rows.filter((row) => row.getAnimations().length > 0).length,
      })
      if (!store.__rowFramesStop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, ROW)
}

async function stopFrames(win: Page): Promise<ReadonlyArray<Frame>> {
  await win.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  return win.evaluate(() => {
    const store = globalThis as { __rowFrames?: Frame[]; __rowFramesStop?: boolean }
    store.__rowFramesStop = true
    return store.__rowFrames ?? []
  })
}

test('a reply from elsewhere slides its row to the top, and a press during the slide opens it; your own Resolve and a reply while scrolled down do not animate; a burst retargets and hiding cancels; reduced motion does not animate', async ({ juno, win, fake }) => {
  await atTheTop(juno, win)
  const mover = await threadInView(juno)
  const row = juno.sidebar.list.locator(`[data-topic-id="${mover}"]`)
  const title = await row.evaluate((el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
  // The motion is slowed once it starts, so the press below lands mid-slide on a busy machine too; the slide's path is the same.
  // Each press records whether its row was moving then.
  await win.evaluate((selector) => {
    const store = globalThis as { __pressedMoving?: boolean }
    const slow = () => {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) for (const animation of el.getAnimations()) animation.playbackRate = 0.2
      requestAnimationFrame(slow)
    }
    requestAnimationFrame(slow)
    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-topic-row]') : null
      store.__pressedMoving = target !== null && target.getAnimations().length > 0
    }, { capture: true, once: true })
  }, ROW)

  replyIn(fake, mover, 'A reply from elsewhere')
  // It takes its new place in the DOM at once and is drawn sliding up from where it was.
  await win.waitForFunction((id) => document.querySelector(`[data-topic-id="${id}"]`)?.getAnimations().length !== 0, mover)
  expect((await recentIds(juno))[0]).toBe(mover)
  const box = (await row.boundingBox())!
  await win.mouse.click(box.x + 40, box.y + 20)
  expect(await win.evaluate(() => (globalThis as { __pressedMoving?: boolean }).__pressedMoving)).toBe(true)
  await juno.topic.expectTitle(title)
  await expect(row).toHaveAttribute('aria-current', 'true')

  // It ends at the top of the list with nothing left moving.
  await expect.poll(() => win.evaluate((selector) => [...document.querySelectorAll(selector)].filter((el) => el.getAnimations().length > 0).length, ROW)).toBe(0)
  const first = await juno.sidebar.list.locator('[data-topic-row]').first().boundingBox()
  expect(await row.boundingBox()).toEqual(first)

  // Your own Resolve and a reply while scrolled down record no motion. Reduced motion goes last: it stays on for the page.
  await test.step('your own Resolve takes its row out in one frame, with no motion', async () => {
    await atTheTop(juno, win)
    const ids = await recentIds(juno)
    const gone = ids[1]!
    const below = ids[2]!
    const title = await juno.sidebar.list.locator(`[data-topic-id="${gone}"]`).evaluate((el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
    const row = juno.sidebar.row(title, { exact: true })
    await recordFrames(win)
    await row.chooseInMenu('resolve')
    await expect.poll(async () => (await recentIds(juno)).includes(gone)).toBe(false)
    const frames = await stopFrames(win)
    const removed = frames.findIndex((frame) => !frame.order.includes(gone))
    expect(removed).toBeGreaterThan(0)
    // In the frame the row went, the row below it is already where the resolved row was, and nothing animates.
    expect(frames[removed]!.tops[below]).toBeCloseTo(frames[removed - 1]!.tops[gone]!, 0)
    expect(frames.every((frame) => frame.animating === 0)).toBe(true)
  })

  await test.step('an outside reply does not animate while scrolled down', async () => {
    await atTheTop(juno, win)
    const mover = await threadInView(juno)
    await juno.sidebar.list.evaluate((list) => { list.scrollTop = 180 })
    await expect.poll(() => juno.sidebar.list.evaluate((list) => list.scrollTop)).toBeGreaterThan(0)
    await recordFrames(win)
    replyIn(fake, mover, 'An update while reading farther down')
    await expect.poll(async () => (await recentIds(juno))[0]).toBe(mover)
    const frames = await stopFrames(win)
    expect(frames.every((frame) => frame.animating === 0)).toBe(true)
  })

  await test.step('a burst retargets the rows, including a row removed during its slide, and releases every animation; hiding the page cancels slides', () => burst(juno, win, fake))

  await test.step('with reduced motion, rows take their new places in one frame', async () => {
    await juno.sidebar.list.evaluate((list) => { list.scrollTop = 0 })
    await win.emulateMedia({ reducedMotion: 'reduce' })
    await atTheTop(juno, win)
    const mover = await threadInView(juno)
    const before = await recentIds(juno)
    await recordFrames(win)
    replyIn(fake, mover, 'A reply from elsewhere, reduced motion')
    await expect.poll(async () => (await recentIds(juno))[0]).toBe(mover)
    const frames = await stopFrames(win)
    const moved = frames.findIndex((frame) => frame.order[0] === mover)
    expect(moved).toBeGreaterThan(0)
    expect(frames.every((frame) => frame.animating === 0)).toBe(true)
    // The first frame of the new order already has the mover at the top slot, where the old top row was.
    expect(frames[moved]!.tops[mover]).toBeCloseTo(frames[moved - 1]!.tops[before[0]!]!, 0)
  })
})

async function burst(juno: Juno, win: Page, fake: FakeSlack): Promise<void> {
  // The step before left the list scrolled down.
  await juno.sidebar.list.evaluate((list) => { list.scrollTop = 0 })
  await atTheTop(juno, win)
  const movers = (await recentIds(juno)).filter((id) => id.startsWith('t:')).slice(2, 4)
  expect(movers).toHaveLength(2)
  // Row animations, slowed by `__motionRate`, are kept in `__motionAnimations`.
  await win.evaluate(() => {
    const store = globalThis as unknown as { __motionAnimations: Animation[]; __motionRate: number }
    store.__motionAnimations = []
    store.__motionRate = 0.2
    const original = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options)
      if (this.hasAttribute('data-topic-row')) {
        animation.playbackRate = store.__motionRate
        store.__motionAnimations.push(animation)
      }
      return animation
    }
  })
  replyIn(fake, movers[0]!, 'The first reply in a burst')
  await win.waitForFunction((id) => (document.querySelector(`[data-topic-id="${id}"]`)?.getAnimations().length ?? 0) > 0, movers[0])
  replyIn(fake, movers[1]!, 'The next reply interrupts the slide')
  await expect.poll(async () => (await recentIds(juno))[0]).toBe(movers[1])
  const [, channel, threadTs] = movers[0]!.split(':')
  fake.unfollowThread({ channel: channel!, threadTs: threadTs! })
  await expect.poll(async () => (await recentIds(juno)).includes(movers[0]!)).toBe(false)
  await expect.poll(() => win.evaluate(() => {
    const { __motionAnimations: animations } = globalThis as unknown as { __motionAnimations: Animation[] }
    return animations.length > 0 && animations.every((animation) => animation.playState === 'idle')
  })).toBe(true)
  const tops = await juno.sidebar.rows.evaluateAll((rows) => rows.slice(0, 10).map((row) => row.getBoundingClientRect().top))
  expect(tops).toEqual([...tops].toSorted((a, b) => a - b))

  await test.step('page visibility cancels active slides and hidden updates start none', async () => {
    await atTheTop(juno, win)
    const used = new Set(movers)
    const next = (await recentIds(juno)).slice(3).filter((id) => id.startsWith('t:') && !used.has(id)).slice(0, 2)
    expect(next).toHaveLength(2)
    await win.evaluate(() => {
      const store = globalThis as unknown as { __motionAnimations: Animation[]; __motionRate: number }
      store.__motionAnimations = []
      store.__motionRate = 0.1
    })
    replyIn(fake, next[0]!, 'An outside reply before hiding')
    await win.waitForFunction((id) => (document.querySelector(`[data-topic-id="${id}"]`)?.getAnimations().length ?? 0) > 0, next[0])
    // Playwright forces visible/focused pages on its own CDP session. Supply the
    // Page Visibility boundary here; a second session cannot undo that override.
    const starts = await win.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
      const { __motionAnimations: animations } = globalThis as unknown as { __motionAnimations: Animation[] }
      if (!animations.every((animation) => animation.playState === 'idle')) throw new Error('Hiding left a row animation running')
      return animations.length
    })
    replyIn(fake, next[1]!, 'An outside reply while hidden')
    await expect.poll(async () => (await recentIds(juno))[0]).toBe(next[1])
    expect(await win.evaluate(() => (globalThis as unknown as { __motionAnimations: Animation[] }).__motionAnimations.length)).toBe(starts)
    await win.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await win.evaluate((selector) => [...document.querySelectorAll(selector)].flatMap((row) => row.getAnimations()).length, ROW)).toBe(0)
  })
}
