// Live messages in an open topic: at the bottom they scroll into view and
// count as read; scrolled up they wait behind "N new messages" and stay
// unread until the user reaches the bottom.
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'

test('a reply that arrives while the topic is open at the bottom shows and keeps the row read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const postgres = juno.sidebar.row(POSTGRES)
  await postgres.open()
  await juno.topic.expectAtBottom()

  // The list grows by the new row and nothing in the topic moves sideways or down.
  const report = await measureLayoutShift(
    juno.win,
    async () => {
      slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
      await juno.topic.expectMessage('Cutover is a go')
    },
    { root: '[data-topic-view]' },
  )
  expect(report.moved.filter((entry) => entry.before.x !== entry.after.x || entry.before.y !== entry.after.y || entry.before.width !== entry.after.width)).toEqual([])
  await juno.topic.expectAtBottom()
  await juno.topic.expectNoPill()
  await postgres.expectPreview('Leo: Cutover is a go')
  await postgres.expectRead()
})

test('a reply that arrives while the window is in the background stays unread until the window is back', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const postgres = juno.sidebar.row(POSTGRES)
  await postgres.open()
  await juno.topic.expectAtBottom()
  await juno.blurWindow()
  slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
  await postgres.expectUnread(1)
  await juno.focusWindow()
  await postgres.expectRead()
})

test.describe('scrolled up', () => {
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1'

  longTest('a reply shows "1 new message" and stays unread until Jump to latest', async ({ juno, slack }) => {
    await juno.signIn()
    await juno.waitForSync()
    const row = juno.sidebar.row(THREAD)
    await row.open()
    await juno.topic.expectAtBottom()
    await row.expectRead()

    await juno.topic.scrollUp(3_000)
    await juno.topic.expectPill('Jump to latest')
    slack.as('Leo').replyIn(THREAD, 'Cutover is a go')
    await juno.topic.expectPill('1 new message')
    await row.expectUnread(1)

    await juno.topic.jumpToLatest()
    await juno.topic.expectAtBottom()
    await juno.topic.expectMessage('Cutover is a go')
    await juno.topic.expectNoPill()
    await row.expectRead()
  })
})
