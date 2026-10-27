// Peek (spec section 5): hold ⌥ (or Space, set in Settings › General) over a
// sidebar row, or over a Main message that has a thread, to read the topic
// in a popover. A peek marks nothing read, opens no tab and moves no focus;
// letting go or moving off the rows closes it. A thread link whose first
// reply is unknown fills in place when the peek's fetch lands. Space as the
// peek key is in the DOM lane (`dom/peek.test.ts`).
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import type { Page } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ENG_MAIN = '#eng'

/**
 * A text field with focus. The composer is not built yet (M6), so a plain
 * input stands in for it; the rule under test is about any text field.
 */
async function focusTextField(win: Page) {
  await win.evaluate(() => {
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Stand-in composer')
    document.body.append(input)
  })
  const field = win.getByRole('textbox', { name: 'Stand-in composer' })
  await field.focus()
  return field
}

test('holding ⌥ over a row or a thread in a Main peeks without marking it, opening it or moving focus, a person in it opens their DM, and a thread link fills in place', async ({ juno, slack, fake, win }) => {
  await test.step('over a row: no mark, no open, no focus move; moving off the rows closes it, and a text field keeps its focus', () => overRow({ juno, slack }))
  await test.step('over a thread in a Main: its replies without opening it, and a person in it opens their DM', () => threadInMain({ juno, slack }))
  await test.step('unknown first replies show only the count and fill in place when a peek fetch lands', () => linkFillsInPlace({ juno, fake, slack, win }))
})

async function overRow({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>): Promise<void> {
  await test.step('moving off the rows closes the peek', async () => {
    await juno.sidebar.row(RINA).peek()
    await juno.peek.expectShowing(RINA)
    await juno.win.mouse.move(900, 400, { steps: 4 })
    await juno.peek.expectClosed()
    await juno.peek.release()
    await juno.expectNothingOpen()
  })
  await test.step('⌥ peeks while a text field has focus, and the field keeps it', async () => {
    const field = await focusTextField(juno.win)
    await juno.sidebar.row(RINA).peek()
    await juno.peek.expectShowing(RINA)
    await expect(field).toBeFocused()
    await juno.peek.release()
    await juno.peek.expectClosed()
  })

  const { sidebar, peek, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await tabs.expectActive(POSTGRES)
  const rina = sidebar.row(RINA)
  await rina.expectUnread(2)
  await sidebar.row(POSTGRES).focus()
  slack.resetCalls()

  // Nothing on screen moves when the peek appears.
  await rina.hover()
  await expectNoLayoutShift(juno.win, async () => {
    await juno.win.keyboard.down('Alt')
    await peek.expectShowing(RINA)
  })
  await peek.expectMessage('Strong systems design')
  await tabs.expectActive(POSTGRES)
  await tabs.expectCount(1)
  await sidebar.row(POSTGRES).expectFocused()

  // Moving to another row while holding the key switches the peek.
  await sidebar.row(POSTGRES).hover()
  await peek.expectShowing(POSTGRES)
  await peek.expectMessage('Booked 2–4pm')

  await expectNoLayoutShift(juno.win, async () => {
    await peek.release()
    await peek.expectClosed()
  })
  await rina.expectUnread(2)
  await tabs.expectActive(POSTGRES)
  await slack.expectNoMarks()
}

async function threadInMain({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>): Promise<void> {
  const { peek, tabs, topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  const link = topic.threadLinkUnder(POSTGRES)
  await expect(link.root).toBeVisible()
  slack.resetCalls()

  // Over the "6 replies" link: the thread shows at its message, and nothing in the topic moves. Its replies
  // are search matches until the peek's fetch brings them in full, which may also change the channel's
  // sidebar row (its preview gives way to what lands at its end), so the check covers the topic.
  await expectNoLayoutShift(
    juno.win,
    async () => {
      await link.peek()
      await peek.expectShowing(POSTGRES)
    },
    { root: '[data-topic-view]' },
  )
  // The peek paints whole: it waits for the full replies rather than growing when they land.
  const first = await peek.root.boundingBox()
  await peek.expectMessage('Booked 2–4pm')
  // Compare once the peek's page of replies has come back (a root lookup asks for one message) and two
  // frames have drawn whatever it changed.
  const root = slack.root(POSTGRES)
  const repliesPage = (call: { readonly method: string; readonly args: Readonly<Record<string, string>> }) =>
    call.method === 'conversations.replies' && call.args['channel'] === root.channel && call.args['ts'] === root.ts && call.args['limit'] !== '1'
  await expect.poll(() => slack.fake.calls.some(repliesPage)).toBe(true)
  await juno.win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await peek.root.boundingBox()).toEqual(first)
  await topic.expectTitle('Main')
  await tabs.expectCount(1)
  // Beside the message, not over it, and only as tall as the thread.
  const message = (await topic.message(POSTGRES).boundingBox())!
  const box = (await peek.root.boundingBox())!
  expect(box.y >= message.y + message.height - 1 || box.y + box.height <= message.y + 1).toBe(true)
  expect(box.height).toBeLessThan((await juno.win.evaluate(() => window.innerHeight)) - 44)
  await peek.release()
  await peek.expectClosed()

  // Over the message's own text too.
  await topic.message(POSTGRES).getByText(POSTGRES, { exact: false }).first().hover()
  await juno.win.keyboard.down('Alt')
  await peek.expectShowing(POSTGRES)
  // Off the message, onto one with no thread: it closes.
  await topic.list.locator('[data-message-row]:not([data-thread])').last().hover()
  await peek.expectClosed()
  await peek.release()

  await topic.expectTitle('Main')
  await tabs.expectCount(1)
  // The thread was not marked read.
  expect(slack.fake.calls.filter((call) => call.method === 'subscriptions.thread.mark')).toEqual([])

  await test.step('a person in the peek opens their DM', async () => {
    slack.as('Maya').replyIn(POSTGRES, 'Maya here: the dry run slot is booked.')
    await topic.threadLinkUnder(POSTGRES).peek()
    await peek.expectShowing(POSTGRES)
    const maya = peek.root.locator('[data-message-header] [data-opens-person]', { hasText: 'Maya' })
    await maya.hover()
    await maya.click()
    await peek.release()
    await tabs.expectActive('Maya')
    await tabs.expectCount(2)
  })
}

const CHECKOUT = 'checkout.spec failed again on main.'
const FIRST_REPLY = 'Sam: Quarantining it. Ticket filed.'

// That the link draws its first reply and repliers is in the DOM lane (`dom/thread-link-preview.test.ts`); here, it fills in place.
async function linkFillsInPlace({ juno, fake, slack, win }: Pick<Fixtures, 'juno' | 'fake' | 'slack' | 'win'>): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  const link = juno.topic.threadLinkUnder(CHECKOUT)
  await expect(link.root).toContainText('5 replies')
  await expect(link.root).not.toContainText(FIRST_REPLY)
  await expect(link.root).not.toContainText(CHECKOUT)
  slack.resetCalls()
  // Local warming and the list do not fetch replies.
  await link.root.hover()
  expect(fake.calls.filter(call => call.method === 'conversations.replies' && call.args['limit'] !== '1')).toEqual([])

  fake.holdNext({ method: 'conversations.replies', reason: 'open' })
  await link.peek()
  await expect.poll(() => fake.heldCount({ method: 'conversations.replies' })).toBe(1)
  await expect(link.root).not.toContainText(FIRST_REPLY)
  const root = slack.root(CHECKOUT)
  await expectStableAnchor(win, `[data-topic-view] [data-message-row="${root.ts}"]`, async () => {
    fake.release({ method: 'conversations.replies' })
    await expect(link.root).toContainText(FIRST_REPLY)
    await juno.peek.expectMessage('Quarantining it. Ticket filed.')
  })
  await juno.peek.release()
}
