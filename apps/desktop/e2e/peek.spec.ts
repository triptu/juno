// Peek (spec section 5): hold ⌥ (or Space, set in Settings › General) over a
// sidebar row, or over a Main message that has a thread, to read the topic
// in a popover. A peek marks nothing read, opens no tab and moves no focus;
// letting go or moving off the rows closes it.
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

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

test('holding ⌥ over a row peeks at the topic without marking it, opening it or moving focus', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('moving off the rows closes the peek', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(RINA).peek()
  await juno.peek.expectShowing(RINA)
  await juno.win.mouse.move(900, 400, { steps: 4 })
  await juno.peek.expectClosed()
  await juno.peek.release()
  await juno.expectNothingOpen()
})

test('⌥ peeks while a text field has focus, and the field keeps it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const field = await focusTextField(juno.win)
  await juno.sidebar.row(RINA).peek()
  await juno.peek.expectShowing(RINA)
  await expect(field).toBeFocused()
  await juno.peek.release()
  await juno.peek.expectClosed()
})

test('with Space as the peek key, Space peeks, ⌥ does not, and Space in a text field types a space', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.setPeekKey('space')
  // Closing Preferences left a New chat, whose composer has focus; Space peeks only outside a text field.
  await juno.win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const rina = juno.sidebar.row(RINA)
  slack.resetCalls()

  await rina.peek('space')
  await juno.peek.expectShowing(RINA)
  await juno.peek.expectMessage('Strong systems design')
  await juno.peek.release('space')
  await juno.peek.expectClosed()
  // Space over a row peeked; it did not open the row.
  await juno.expectNothingOpen()

  await rina.peek('option')
  await juno.win.waitForTimeout(300)
  await juno.peek.expectClosed()
  await juno.peek.release('option')

  const field = await focusTextField(juno.win)
  await rina.hover()
  await juno.win.keyboard.press('Space')
  await expect(field).toHaveValue(' ')
  await juno.peek.expectClosed()

  await rina.expectUnread(2)
  await slack.expectNoMarks()
})

test('holding ⌥ over a thread in a Main peeks at its replies without opening it', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { peek, tabs, topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  const link = topic.threadLink(/^6 replies: Draft plan/)
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
  await juno.win.waitForTimeout(300)
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
  await juno.win.waitForTimeout(1_000)
  expect(slack.fake.calls.filter((call) => call.method === 'subscriptions.thread.mark')).toEqual([])
})
