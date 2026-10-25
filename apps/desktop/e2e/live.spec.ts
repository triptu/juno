// Live messages in an open topic, scrolled up: they wait behind "N new
// messages" and stay unread until the user reaches the bottom. At the bottom
// they show and count as read (dom/live.test.ts).
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

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
    // The replies came only from getView, which proves them for the count, not the view: the window stands in with
    // them at once, and the open's pages prove them first.
    await juno.topic.expectMessage('Review the rollout checklist 300')
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
