// At the bottom the list keeps its bottom (SPEC 7, "Stable geometry"): a message that arrives while the user sits
// at the end of a list longer than the view is fully in view on the first frame that draws it, and the list stays
// at its end. Sitting there includes turning the wheel down at the end and clicking a message, which scroll
// nothing. Scrolled up, an arriving message moves nothing and the pill shows.
import type { Locator, Page } from '@playwright/test'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import type { Slack } from './driver/slack'
import { expect, test } from './fixtures'
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

test('Main at the bottom keeps a new message fully in view after a click on a message', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
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
})

test('Main at the bottom keeps its last message in view while the composer grows', async ({ juno, win, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', 'Earlier message 29')
  await juno.topic.composer.fill('one\ntwo\nthree\nfour\nfive')
  await frames(win, 5)
  expectHeldAtEnd(await watched())
})

test('scrolled up in Main, a new message moves nothing and shows the pill', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  await juno.topic.scrollUp(600)
  await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
    fake.injectMessage({ channel, user: slack.as('Maya').id, text: 'A new message while scrolled up' })
    await juno.topic.expectPill('1 new message')
  })
})

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
})
