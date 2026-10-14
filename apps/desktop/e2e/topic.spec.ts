// Reading a topic against the fake Slack: where it opens, the read rule,
// older pages without a shift, Main's thread links and Threads list, a
// #channel chip, and prefetch.
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'

test('a topic with unread messages opens at the "N new" divider and is marked read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rina = juno.sidebar.row(RINA)
  await rina.expectUnread(2)

  await rina.open()
  await juno.topic.expectTitle(RINA)
  await juno.topic.expectDividerBefore('Strong systems design')
  await juno.topic.expectNew(2)
  await rina.expectRead()
  // The divider stays where the pointer was when the topic opened.
  await juno.topic.expectNew(2)
  // The thread is followed, so the mark reaches Slack.
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.mark'), { timeout: 10_000 }).toBe(true)
})

test('a read topic opens at the bottom with no divider', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.topic.expectNoDivider()
  await juno.topic.expectAtBottom()
})

test('Main shows thread links; a link opens the thread in the tab, and Threads lists the channel’s threads', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const main = juno.sidebar.row(ENG_MAIN)
  await main.expectNewThreads(1)
  await main.open()
  await juno.topic.expectTitle('#eng')
  await expect(juno.topic.threadLink(/^6 replies: Draft plan/).root).toBeVisible()

  await juno.topic.threadLink(/^6 replies: Draft plan/).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)

  // The Threads list: opening an unfollowed thread does not add it to the sidebar; subscribing does.
  await main.open()
  let threads = await juno.topic.openThreads()
  await threads.open(CHECKOUT)
  await juno.topic.expectTitle(CHECKOUT)
  await juno.tabs.expectCount(1)
  await juno.sidebar.row(CHECKOUT).expectAbsent()

  await main.open()
  threads = await juno.topic.openThreads()
  await threads.subscribe(CHECKOUT)
  await juno.sidebar.row(CHECKOUT).expectVisible()

  // From the keyboard: Tab reaches the rows, which are buttons named by their title; Escape returns to the Threads button.
  threads = await juno.topic.openThreadsWithKeyboard()
  await juno.win.keyboard.press('Tab')
  await expect(threads.root.getByRole('button').first()).toBeFocused()
  await expect(threads.row(CHECKOUT)).toBeVisible()
  await juno.win.keyboard.press('Escape')
  await expect(threads.root).toHaveCount(0)
  await expect(juno.topic.threadsButton).toBeFocused()
})

test('a #channel chip scopes the sidebar to that channel', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.clickChannel('platform')
  await juno.sidebar.expectScope('platform')
  await juno.sidebar.row(POSTGRES).expectAbsent()
})

test('hovering a row warms the topic without asking Slack', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  slack.resetCalls()
  await juno.sidebar.row(POSTGRES).hover()
  await juno.win.waitForTimeout(500)
  expect(slack.fake.calls.map((call) => call.method)).toEqual([])
  // The open is a cache hit: the tab paints with its rows.
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await expect.poll(() => juno.measure('juno.topic-open')).toBeLessThan(250)
})

test.describe('a long thread', () => {
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1.'

  longTest('opens 80px above the first new reply, and older pages load without moving what is on screen', async ({ juno, slack }) => {
    await juno.signIn()
    await juno.waitForSync()
    const row = juno.sidebar.row(THREAD)
    // The first open reads the whole thread; close it and let 40 replies arrive.
    await row.open()
    await juno.topic.expectAtBottom()
    await row.expectRead()
    await juno.tabs.close(THREAD)
    for (let i = 0; i < 40; i++) slack.as('Leo').replyIn(THREAD, `Follow-up ${i + 1} on the checklist.`)
    await row.expectUnread(40)

    await row.open()
    await juno.topic.expectDividerBefore('Follow-up 1 on the checklist.')
    await juno.topic.expectThumbnailsLoaded()
    expect(Math.round(await juno.topic.dividerOffset())).toBe(80)
    await juno.topic.expectNew(40)

    // Up to the top: the next page goes in above the rows in view, which stay put.
    const before = await juno.topic.rowCount()
    let anchor = await juno.topic.firstVisibleRow()
    const report = await measureLayoutShift(
      juno.win,
      async () => {
        await juno.topic.scrollToTop()
        anchor = await juno.topic.firstVisibleRow()
        await expect.poll(() => juno.topic.rowCount(), { timeout: 15_000 }).toBeGreaterThan(before)
      },
      { root: '[data-topic-view]', settleMs: 200 },
    )
    expect(await juno.topic.rowTop(anchor.ts)).toBeCloseTo(anchor.top, 0)
    expect(report.shifts).toEqual([])
  })
})
