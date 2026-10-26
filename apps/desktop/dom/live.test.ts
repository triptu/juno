// Live messages in an open topic (spec section 7): a reply that arrives while
// the topic is open at the bottom shows and counts as read, unless the window
// is in the background. Scrolled up, behind "N new messages", is the browser
// lane's (topic.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

domTest('a reply that arrives while the topic is open at the bottom shows and keeps the row read, unless the window is in the background', async ({ juno, slack, step }) => {
  const postgres = juno.sidebar.row(POSTGRES)
  await postgres.open()
  await juno.topic.expectTitle(POSTGRES)

  await step('a reply that arrives while the topic is open shows and keeps the row read', async () => {
    slack.resetCalls()
    slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
    await juno.topic.expectMessage('Cutover is a go')
    await expect(juno.topic.root.getByRole('button', { name: /new message|Jump to latest/ })).toHaveCount(0)
    await postgres.expectPreview('Leo: Cutover is a go')
    await postgres.expectRead()
    // The row reads as read before its mark leaves for Slack; the next step counts marks from here.
    await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.mark'), { timeout: 10_000 }).toBe(true)
  })

  await step('a reply that arrives while the window is in the background stays unread until the window is back', async () => {
    await juno.blurWindow()
    slack.resetCalls()
    slack.as('Leo').replyIn(POSTGRES, 'Rollback window confirmed')
    await postgres.expectPreview('Leo: Rollback window confirmed')
    await slack.expectNoMarks()
    await postgres.expectUnread(1)
    await juno.focusWindow()
    await postgres.expectRead()
  })
})
