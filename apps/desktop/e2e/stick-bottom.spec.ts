// At the bottom the list keeps its bottom (SPEC 7, "Stable geometry"): a message that arrives while the user sits
// at the end of a list longer than the view is fully in view on the first frame that draws it, and the list stays
// at its end. Sitting there includes turning the wheel down at the end and clicking a message, which scroll
// nothing. The last message growing at the bottom (a reaction, its edit box) stays whole above the composer, and an
// edit box started just above the bottom shows whole too. Scrolled up, an arriving message or a reaction moves nothing.
import type { Locator, Page } from '@playwright/test'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import type { Slack } from './driver/slack'
import { expect, test, type Fixtures } from './fixtures'
import { answer, JunoChatPane, test as chatTest } from './juno-agent/chat'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 90_000, mode: 'parallel' })

interface Frame {
  readonly present: boolean
  readonly inView: boolean
  readonly distance: number
}

/**
 * Reads, after every paint, whether the newest `row` that contains `text` exists, is fully inside the scroller
 * `scroller`, and how far the scroller is from its end. The returned function stops and answers the frames from
 * the first that has the row.
 */
async function watchArrival(page: Page, scroller: string, row: string, text: string): Promise<() => Promise<Frame[]>> {
  await page.evaluate(
    ({ scroller, row, text }) => {
      const state = { frames: [] as Frame[], on: true }
      ;(window as unknown as { arrival: typeof state }).arrival = state
      const tick = () => {
        const list = [...document.querySelectorAll<HTMLElement>(scroller)].find((node) => node.getClientRects().length > 0)
        if (list !== undefined) {
          const node = [...list.querySelectorAll(row)].findLast((candidate) => candidate.textContent?.includes(text) === true)
          const box = list.getBoundingClientRect()
          const at = node?.getBoundingClientRect()
          state.frames.push({
            present: at !== undefined,
            inView: at !== undefined && at.top >= box.top - 1 && at.bottom <= box.bottom + 1,
            distance: list.scrollHeight - list.scrollTop - list.clientHeight,
          })
        }
        // After the frame is painted: a resize observer runs after animation frame callbacks, before paint.
        if (state.on) requestAnimationFrame(() => setTimeout(tick, 0))
      }
      requestAnimationFrame(() => setTimeout(tick, 0))
    },
    { scroller, row, text },
  )
  return () =>
    page.evaluate(() => {
      const state = (window as unknown as { arrival: { frames: Frame[]; on: boolean } }).arrival
      state.on = false
      const first = state.frames.findIndex((frame) => frame.present)
      return first < 0 ? [] : state.frames.slice(first)
    })
}

/** Every frame from the first that draws the row shows it whole, with the list at its end. */
function expectHeldAtEnd(frames: Frame[]): void {
  expect(frames.length, 'the row is drawn').toBeGreaterThan(1)
  expect(frames.filter((frame) => !frame.inView || frame.distance > 1)).toEqual([])
}

const frames = (page: Page, count: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    count,
  )

const distance = (scroller: Locator) => scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)

/** Turns the wheel down over a list already at its end, as a user sitting there does: nothing scrolls. */
async function wheelDownAtEnd(page: Page, scroller: Locator): Promise<void> {
  const box = await scroller.boundingBox()
  if (box === null) throw new Error('No list to turn the wheel over')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
  await frames(page, 10)
  expect(await distance(scroller)).toBeLessThanOrEqual(1)
}

const TOPIC_SCROLLER = '[data-topic-view] [data-scroll]'
const PANEL_SCROLLER = 'aside[data-juno-panel] [data-scroll]'
const longerThanView = (scroller: Locator) => scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 1.5)

/** #eng's Main with 30 more messages than the seed, open at its end. */
async function openLongMain(juno: Juno, fake: FakeSlack, slack: Slack): Promise<string> {
  const channel = slack.channel('eng')
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: slack.as(i % 2 === 0 ? 'Maya' : 'Leo').id, text: `Earlier message ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('Earlier message 29')
  await juno.topic.toLatest()
  expect(await longerThanView(juno.topic.scroller)).toBe(true)
  return channel
}

test('a thread at the bottom keeps a new reply fully in view', async ({ juno, win, slack, fake }) => {
  const channel = slack.channel('eng')
  const leo = slack.as('Leo').id
  const root = fake.injectMessage({ channel, user: leo, text: 'Stick to the bottom thread check' })
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: i % 2 === 0 ? leo : slack.as('Maya').id, threadTs: root.ts, text: `Reply ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`).click()
  await juno.topic.expectMessage('Reply 29')
  await juno.topic.toLatest()
  expect(await longerThanView(juno.topic.scroller)).toBe(true)
  await wheelDownAtEnd(win, juno.topic.scroller)

  const text = 'A new reply at the bottom of the thread'
  const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
  fake.injectMessage({ channel, user: leo, threadTs: root.ts, text })
  await juno.topic.expectMessage(text)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await juno.topic.expectNoPill()
})

test('keeps Main at the bottom through arrivals and composer growth, and holds its position when scrolled up', async ({ juno, win, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const context = { juno, win, slack, fake }
  await test.step('Main at the bottom keeps a new message fully in view after a click on a message', () => mainArrival(context))
  await test.step('Main at the bottom keeps its last message in view while the composer grows', () => composerGrowth(context))
  await test.step('scrolled up in Main, a new message moves nothing and shows the pill', () => scrolledUpArrival(context))
})

/** Every frame from the first that draws the element shows it whole, at the list's end or anywhere in view. */
function expectWhole(frames: Frame[], { atEnd }: { readonly atEnd: boolean }): void {
  expect(frames.length, 'the element is drawn').toBeGreaterThan(1)
  expect(frames.filter((frame) => !frame.inView || (atEnd && frame.distance > 1))).toEqual([])
}

const EDITING = '[data-message-row][data-editing]'

test('keeps the last message of Main whole as it grows at the bottom, and still when scrolled up', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  const { topic } = juno

  await test.step('at the bottom, a reaction from someone else on the last message shows whole', async () => {
    const text = 'A message Leo reacts to'
    const message = fake.injectMessage({ channel, user: slack.as('Maya').id, text })
    await topic.expectMessage(text)
    await topic.expectAtBottom()
    const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
    fake.addReaction({ channel, ts: message.ts, name: 'eyes', user: slack.as('Leo').id })
    await expect(topic.message(text).getByRole('button', { name: /👀/ })).toBeVisible()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
  })

  const own = 'My message to react to and edit'
  await test.step('at the bottom, the user’s own reaction on the last message shows whole', async () => {
    await topic.send(own)
    await topic.expectSent(own)
    await topic.expectAtBottom()
    const row = topic.message(own)
    await row.hover()
    const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', own)
    await row.getByRole('button', { name: 'React 👍' }).click()
    await expect(row.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
  })

  await test.step('at the bottom, editing the last message shows the whole edit box', async () => {
    await win.mouse.move(0, 0)
    await topic.composer.focus()
    await topic.composer.press('ArrowUp')
    await expect(topic.message(own)).toBeFocused()
    const watched = await watchArrival(win, TOPIC_SCROLLER, EDITING, '')
    await topic.message(own).press('e')
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
    await win.keyboard.press('Escape')
    await expect(topic.list.locator(EDITING)).toHaveCount(0)
  })

  await test.step('just above the bottom, editing the last message from its menu shows the whole edit box', async () => {
    await topic.expectAtBottom()
    await topic.scrollUp(40)
    expect(await distance(topic.scroller)).toBeGreaterThan(32)
    const row = topic.message(own)
    await row.hover()
    const watched = await watchArrival(win, TOPIC_SCROLLER, EDITING, '')
    await juno.chooseNextMenuItem('edit', { hold: true })
    await row.getByRole('button', { name: 'More', exact: true }).click()
    await juno.releaseMenu()
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: false })
    await win.keyboard.press('Escape')
    await expect(topic.list.locator(EDITING)).toHaveCount(0)
  })

  await test.step('scrolled up, a reaction on the last message moves nothing', async () => {
    const text = 'The last message, reacted to while scrolled up'
    await topic.send(text)
    await topic.expectSent(text)
    await topic.expectAtBottom()
    await topic.scrollUp(600)
    const top = await topic.scroller.evaluate((node) => node.scrollTop)
    const ts = fake.messages(channel).find((m) => m.text === text)!.ts
    await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
      fake.addReaction({ channel, ts, name: 'tada', user: slack.as('Maya').id })
      await expect(topic.message(text).getByRole('button', { name: /🎉/ })).toHaveCount(1)
    })
    expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBe(top)
  })
})

test('releases the bottom during an upward gesture and uses the resting threshold for later growth', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  const { topic } = juno
  const last = fake.messages(channel).find((message) => message.text === 'Earlier message 29')!
  const grown = 'The last message grows\nAnother line\nAnd another line'

  await test.step('growth during a continuous upward gesture does not pull the list back down', async () => {
    const box = (await topic.scroller.boundingBox())!
    const start = await topic.scroller.evaluate((node) => node.scrollTop)
    const cdp = await win.context().newCDPSession(win)
    try {
      const gesture = cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: 900, speed: 600, gestureSourceType: 'mouse', preventFling: false })
      try {
        await expect.poll(() => topic.scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - 64)
        fake.editMessage({ channel, ts: last.ts, text: grown })
        await topic.expectMessage('The last message grows')
        expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - 64)
      } finally {
        await gesture
      }
    } finally {
      await cdp.detach()
    }
    expect(await distance(topic.scroller)).toBeGreaterThan(600)
  })

  await test.step('resting within 32px holds the bottom on growth', async () => {
    await topic.toLatest()
    await topic.scrollUp(16)
    expect(await distance(topic.scroller)).toBeLessThanOrEqual(32)
    fake.editMessage({ channel, ts: last.ts, text: `${grown}\nOne more line` })
    await topic.expectMessage('One more line')
    await frames(win, 5)
    expect(await distance(topic.scroller)).toBeLessThanOrEqual(1)
  })

  await test.step('resting outside 32px leaves the viewport alone on growth', async () => {
    await topic.scrollUp(40)
    expect(await distance(topic.scroller)).toBeGreaterThan(32)
    const top = await topic.scroller.evaluate((node) => node.scrollTop)
    await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
      fake.editMessage({ channel, ts: last.ts, text: `${grown}\nOne more line\nThe final line` })
      await topic.expectMessage('The final line')
    })
    expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBe(top)
  })
})

test('an upward gesture escapes concurrent column growth from the first scroll frame', async ({ juno, win, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  await expectScrollEscapesGrowth(win, juno.topic.scroller, juno.topic.list.locator('[data-message-row]').last())
})

/** Repeated late DOM layout, without a message-data commit, during the start of a real upward gesture. */
async function expectScrollEscapesGrowth(win: Page, scroller: Locator, row: Locator): Promise<void> {
  const box = (await scroller.boundingBox())!
  const start = await scroller.evaluate((node) => node.scrollTop)
  const distance = Math.min(900, start)
  expect(distance).toBeGreaterThan(100)
  const cdp = await win.context().newCDPSession(win)
  try {
    const growing = row.evaluate((row) => new Promise<void>((resolve) => {
      let frame = 0
      const grow = () => {
        row.style.paddingBottom = `${++frame * 12}px`
        if (frame < 45) requestAnimationFrame(grow)
        else resolve()
      }
      requestAnimationFrame(grow)
    }))
    await Promise.all([
      growing,
      cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: distance, speed: 900, gestureSourceType: 'mouse', preventFling: false }),
    ])
    await frames(win, 5)
    expect(await scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - distance * 2 / 3)
  } finally {
    await cdp.detach()
  }
}

async function mainArrival({ juno, win, slack, fake }: Pick<Fixtures, 'juno' | 'win' | 'slack' | 'fake'>): Promise<void> {
  const channel = slack.channel('eng')
  await juno.topic.message('Earlier message 29').click()
  await frames(win, 10)
  expect(await distance(juno.topic.scroller)).toBeLessThanOrEqual(1)

  const text = 'A new message at the bottom of Main'
  const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
  fake.injectMessage({ channel, user: slack.as('Maya').id, text })
  await juno.topic.expectMessage(text)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await juno.topic.expectNoPill()
}

async function composerGrowth({ juno, win }: Pick<Fixtures, 'juno' | 'win'>): Promise<void> {
  const height = await juno.topic.scroller.evaluate((node) => node.clientHeight)
  const watched = await watchResize(win, TOPIC_SCROLLER)
  await juno.topic.composer.fill('one\ntwo\nthree\nfour\nfive')
  // The first entry is the observer's own first look, before the composer grew; a later one is the list shrunk.
  expectHeldAtEnd(await watched(height))
  expect(await distance(juno.topic.scroller)).toBeLessThanOrEqual(1)
}

async function scrolledUpArrival({ juno, win, slack, fake }: Pick<Fixtures, 'juno' | 'win' | 'slack' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  await juno.topic.expectAtBottom()
  const channel = slack.channel('eng')
  await juno.topic.scrollUp(600)
  await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
    fake.injectMessage({ channel, user: slack.as('Maya').id, text: 'A new message while scrolled up' })
    await juno.topic.expectPill('1 new message')
  })
}

/**
 * Reads, each time the scroller's box changes size, whether its last row is fully inside it and how far it is from
 * its end. An observer created after the app's runs after it in the same frame, after layout and before paint, so
 * it reads what that frame paints; a read from a task could land after the size change and before the frame.
 * Returns once the observer's own first look is in, and a function that waits for an entry at a height below
 * `below` and answers every entry.
 */
async function watchResize(page: Page, scroller: string): Promise<(below: number) => Promise<Frame[]>> {
  await page.evaluate(
    (scroller) =>
      new Promise<void>((resolve) => {
        const list = [...document.querySelectorAll<HTMLElement>(scroller)].find((node) => node.getClientRects().length > 0)!
        const state = { frames: [] as Frame[], heights: [] as number[], observer: undefined as ResizeObserver | undefined }
        ;(window as unknown as { resized: typeof state }).resized = state
        state.observer = new ResizeObserver(() => {
          const box = list.getBoundingClientRect()
          const at = [...list.querySelectorAll('[data-message-row]')].at(-1)?.getBoundingClientRect()
          state.frames.push({ present: at !== undefined, inView: at !== undefined && at.top >= box.top - 1 && at.bottom <= box.bottom + 1, distance: list.scrollHeight - list.scrollTop - list.clientHeight })
          state.heights.push(list.clientHeight)
          resolve()
        })
        state.observer.observe(list)
      }),
    scroller,
  )
  return async (below) => {
    await page.waitForFunction((below) => (window as unknown as { resized: { heights: number[] } }).resized.heights.some((height) => height < below), below)
    return page.evaluate(() => {
      const state = (window as unknown as { resized: { frames: Frame[]; observer: ResizeObserver } }).resized
      state.observer.disconnect()
      return state.frames
    })
  }
}

/** The chat test with a model that holds its answer to a message with "held" in it until the gate opens. */
const heldTest = chatTest.extend<{ readonly gate: { readonly wait: Promise<void>; readonly open: () => void } }>({
  // oxlint-disable-next-line no-empty-pattern
  gate: async ({}, use) => {
    let open = () => {}
    const wait = new Promise<void>((resolve) => (open = resolve))
    await use({ wait, open })
    open()
  },
  model: async ({ gate }, use) => {
    const model = await startFakeOpenRouter({
      answer: async (request) => {
        if (request.input.includes('held')) await gate.wait
        return answer(request)
      },
    })
    await use(model)
    await model.close()
  },
})

heldTest('the Juno panel at the bottom keeps a new answer fully in view', async ({ juno, win, gate }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(1400, window.getSize()[1]!)
  })
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(win)
  for (let i = 1; i <= 8; i++) {
    const ask = `question ${i}: what did Leo and Maya decide about the cutover window, the fallback primary and who reviews the plan`
    await panel.send(ask)
    await panel.expectJuno(`You said: ${ask}`)
  }
  const scroller = win.locator(PANEL_SCROLLER)
  await frames(win, 5)
  expect(await longerThanView(scroller)).toBe(true)

  // Juno is still answering while the owner, at the end, turns the wheel down.
  const ask = 'a held question at the bottom of the panel'
  await panel.send(ask)
  await panel.expectOwner(ask)
  await frames(win, 5)
  await wheelDownAtEnd(win, scroller)
  const watched = await watchArrival(win, PANEL_SCROLLER, '[data-chat-juno]', `You said: ${ask}`)
  gate.open()
  await panel.expectJuno(`You said: ${ask}`)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await expectScrollEscapesGrowth(win, scroller, scroller.locator('[data-chat-juno]').last())
})
