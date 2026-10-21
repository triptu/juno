// Each tab keeps its own scroll position (SPEC section 6): one topic open in two tabs scrolls apart, the row a
// wheel jump lands on stays put as the rows around it reach their real height, and a tab left in the middle of a
// long topic comes back there after messages arrive while it is hidden. The topic300 seed mixes row heights.
import type { Page } from '@playwright/test'
import { startFakeSlack, topic300Seed, TOPIC300_THREAD_CHANNEL } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 120_000 })

/** Waits for `count` animation frames. */
const frames = (page: Page, count: number) =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    let left = count
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
  }), count)

test.describe('one topic in two tabs', () => {
  let threadTs = ''
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void (threadTs = topic300Seed()(workspace, avatars).threadTs) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1'

  longTest('each tab keeps its own scroll position', async ({ juno }) => {
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
    // The wheel jumps onto rows still at their size estimate; they reach their real height without moving the row in view.
    const up = await topic.scrollUp(2400)
    await frames(juno.win, 5)
    expect(await topic.rowTop(up.ts)).toBeCloseTo(up.top, 0)

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

  longTest('a tab left in the middle of a long topic comes back there after messages arrive while it is hidden', async ({ juno, fake, win }) => {
    await juno.signIn()
    await juno.waitForSync()
    const { sidebar, tabs, topic } = juno
    await sidebar.row(THREAD).open()
    await topic.expectAtBottom()
    await sidebar.row(THREAD).openInNewTab()
    await tabs.expectActiveAt(THREAD, 1)
    await topic.expectAtBottom()
    // Half the window up, past the rows kept laid out at the end, among rows of every height at their estimate.
    const middle = await topic.scrollUp(5000)

    // The first tab follows the new replies at the bottom; the window drops as many rows from its top.
    await tabs.selectAt(THREAD, 0)
    await tabs.expectActiveAt(THREAD, 0)
    for (const n of [1, 2, 3]) fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text: `A reply while the other tab is hidden ${n}` })
    await topic.expectMessage('A reply while the other tab is hidden 3')
    await topic.expectAtBottom()

    // The second tab comes back with that row where it was, in its first frame and every frame after.
    await expectStableAnchor(win, `[data-message-row="${middle.ts}"]`, async () => {
      await tabs.selectAt(THREAD, 1)
      await tabs.expectActiveAt(THREAD, 1)
      expect(await topic.rowTop(middle.ts)).toBeCloseTo(middle.top, 0)
      await topic.expectPill('3 new messages')
    })
  })
})
