// Each tab keeps its own scroll position (SPEC section 6): one topic open in two tabs scrolls apart, the row a
// scroll lands on stays put as the rows around it reach their real height, and a tab left in the middle of a long
// topic comes back there after messages arrive while it is hidden: after a wheel jump, with a gap between groups at
// the top edge, and after a click that scrolled nothing. The topic300 seed mixes row heights.
import { startFakeSlack, topic300Seed, TOPIC300_THREAD_CHANNEL, type FakeSlack } from '@juno/fake-slack'
import type { Juno, Landing } from './driver/juno'
import { expect, test } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 120_000 })

/** Frames followed after a scroll ends. */
const FRAMES = 10

/** Every frame from `scrollend` on showed the row it landed on where it landed. */
function expectStill(landing: Landing): void {
  expect(landing.tops.length).toBe(FRAMES)
  expect(landing.tops.filter((top) => Math.abs(top - landing.top) >= 0.5), `row ${landing.ts} must stay at ${landing.top}`).toEqual([])
}

const THREAD = 'Review the rollout checklist 1'
let threadTs = ''
const longTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: (workspace, avatars) => void (threadTs = topic300Seed()(workspace, avatars).threadTs) })
    await use(fake)
    await fake.close()
  },
})

/** The thread open in two tabs, the second active, both at the bottom. */
async function openTwice(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs, topic } = juno
  await sidebar.row(THREAD).open()
  await topic.expectAtBottom()
  // ⌘-click opens the topic again in a new tab, though a tab shows it.
  await sidebar.row(THREAD).openInNewTab()
  await expect(tabs.tab(THREAD)).toHaveCount(2)
  await tabs.expectActiveAt(THREAD, 1)
  await topic.expectAtBottom()
}

/**
 * The first tab follows three new replies at the bottom, and the window drops as many rows from its top; then the
 * second tab comes back with `row` where it was, in its first frame and every frame after. `meanwhile` runs while
 * the second tab is hidden.
 */
async function hideWhileRepliesArrive(juno: Juno, fake: FakeSlack, row: { readonly ts: string; readonly top: number }, meanwhile?: () => Promise<unknown>): Promise<void> {
  const { tabs, topic } = juno
  await tabs.selectAt(THREAD, 0)
  await tabs.expectActiveAt(THREAD, 0)
  await meanwhile?.()
  for (const n of [1, 2, 3]) fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text: `A reply while the other tab is hidden ${n}` })
  await topic.expectMessage('A reply while the other tab is hidden 3')
  await topic.expectAtBottom()
  await expectStableAnchor(juno.win, `[data-message-row="${row.ts}"]`, async () => {
    await tabs.selectAt(THREAD, 1)
    await tabs.expectActiveAt(THREAD, 1)
    expect(await topic.rowTop(row.ts)).toBeCloseTo(row.top, 0)
    await topic.expectPill('3 new messages')
  })
}

/** A point on the text of the row in the middle of the view. */
function textInMiddle(juno: Juno): Promise<{ readonly x: number; readonly y: number }> {
  return juno.topic.scroller.evaluate((scroller) => {
    const box = scroller.getBoundingClientRect()
    const middle = box.top + box.height / 2
    const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-row]')].find((node) => node.getBoundingClientRect().bottom > middle)!
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, (node) => (node.textContent?.startsWith('Review the rollout') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP))
    const range = document.createRange()
    range.selectNodeContents(walker.nextNode()!)
    const text = range.getClientRects()[0]!
    return { x: text.left + 20, y: text.top + text.height / 2 }
  })
}

test.describe('one topic in two tabs', () => {
  longTest('each tab keeps its own scroll position', async ({ juno }) => {
    await openTwice(juno)
    const { sidebar, tabs, topic } = juno
    // The wheel jumps onto rows still at their size estimate; they reach their real height without moving the row in view.
    const up = await topic.scrollUp(2400, FRAMES)
    expectStill(up)

    // The first tab is still at the bottom; the second is where it was left.
    await tabs.selectAt(THREAD, 0)
    await tabs.expectActiveAt(THREAD, 0)
    await topic.expectAtBottom()
    await tabs.selectAt(THREAD, 1)
    await tabs.expectActiveAt(THREAD, 1)
    // The row that was first in view is back where it was. Which row counts as first can flip on a
    // sub-pixel when a row edge sits on the list's top, so the same row is followed instead.
    expect(await topic.rowTop(up.ts)).toBeCloseTo(up.top, 0)

    // A plain open focuses the tab that was active last, without moving it.
    await tabs.selectAt(THREAD, 0)
    await sidebar.row(THREAD).open()
    await tabs.expectActiveAt(THREAD, 0)
    await topic.expectAtBottom()
    await expect(tabs.tab(THREAD)).toHaveCount(2)
  })

  longTest('a tab left in the middle of a long topic comes back there after messages arrive while it is hidden', async ({ juno, fake }) => {
    await openTwice(juno)
    // Half the window up, past the rows kept laid out at the end, among rows of every height at their estimate.
    const middle = await juno.topic.scrollUp(5000, FRAMES)
    expectStill(middle)
    await hideWhileRepliesArrive(juno, fake, middle)
  })

  longTest('a scroll that ends with a gap between groups at the top edge comes back there too', async ({ juno, fake }) => {
    await openTwice(juno)
    expectStill(await juno.topic.scrollUp(5000, FRAMES))
    // No row is under the top edge; the first row whose top is in view is the one that stays.
    const gap = await juno.topic.scrollToGroupGap(FRAMES)
    expectStill(gap)
    await hideWhileRepliesArrive(juno, fake, gap)
  })

  longTest('a click that scrolls nothing keeps the tab where it is for the next switch', async ({ juno, fake, app }) => {
    await openTwice(juno)
    const { topic, win } = juno
    expectStill(await topic.scrollUp(5000, FRAMES))
    // A click on the text of a row in the middle of the view: the press lets go of the held row, and no scroll ends.
    const at = await textInMiddle(juno)
    await win.mouse.click(at.x, at.y)
    const row = await topic.firstVisibleRow()
    // The window narrows while the tab is hidden, so the rows around the view wrap again before it is laid out.
    await hideWhileRepliesArrive(juno, fake, row, () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 700)))
  })
})
