// Each tab keeps its own scroll position (SPEC section 6): a tab left in the middle of a long topic comes back there
// after messages arrive while it is hidden, with a gap between groups at the top edge, and after a click that
// scrolled nothing. The topic300 seed mixes row heights. One topic in two tabs after a wheel jump is a step of the
// long thread journey in topic.spec.ts.
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
const longTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: topic300Seed() })
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
 * the second tab is hidden. `round` tells each call's replies apart.
 */
async function hideWhileRepliesArrive(juno: Juno, fake: FakeSlack, round: number, row: { readonly ts: string; readonly top: number }, meanwhile?: () => Promise<unknown>): Promise<void> {
  const { tabs, topic } = juno
  await tabs.selectAt(THREAD, 0)
  await tabs.expectActiveAt(THREAD, 0)
  await meanwhile?.()
  const threadTs = fake.workspace.main(TOPIC300_THREAD_CHANNEL).find((message) => message.text?.startsWith(THREAD))!.ts
  for (const n of [1, 2, 3]) fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text: `A reply while the other tab is hidden ${round}.${n}` })
  await topic.expectMessage(`A reply while the other tab is hidden ${round}.3`)
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
  longTest('a tab left in the middle of a long topic comes back there after messages arrive while it is hidden: at a gap between groups, and after a click that scrolled nothing', { tag: ['@nightly', '@nightly-scroll'] }, async ({ juno, fake }) => {
    await openTwice(juno)
    const { topic, win } = juno
    /** The second tab back at the bottom with nothing new below, then half the window up, among rows of every height at their estimate. */
    const halfUp = async () => {
      await topic.toLatest()
      await topic.expectNoPill()
      const up = await topic.scrollUp(5000, FRAMES)
      expectStill(up)
      return up
    }

    await test.step('a scroll that ends with a gap between groups at the top edge', async () => {
      await halfUp()
      // No row is under the top edge; the first row whose top is in view is the one that stays.
      const gap = await topic.scrollToGroupGap(FRAMES)
      expectStill(gap)
      await hideWhileRepliesArrive(juno, fake, 2, gap)
    })

    await test.step('a click that scrolls nothing keeps the tab where it is for the next switch', async () => {
      await halfUp()
      // A click on the text of a row in the middle of the view: the press lets go of the held row, and no scroll ends.
      const at = await textInMiddle(juno)
      await win.mouse.click(at.x, at.y)
      const row = await topic.firstVisibleRow()
      // The window narrows while the tab is hidden, so the rows around the view wrap again before it is laid out.
      await hideWhileRepliesArrive(juno, fake, 3, row, () => juno.setWindowSize(760, 700))
    })
  })
})
