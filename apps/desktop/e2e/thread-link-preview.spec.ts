import { expect, syncedTest, test } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

const ROOT = 'checkout.spec failed again on main.'
const FIRST_REPLY = 'Sam: Quarantining it. Ticket filed.'

syncedTest('Main previews the first reply after opening a thread, never the root or newest reply', async ({ juno }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.threadLinkUnder(ROOT).open()
  await juno.topic.expectMessage('Quarantining it. Ticket filed.')
  await juno.sidebar.row('#eng').open()
  const link = juno.topic.threadLinkUnder(ROOT).root
  await expect(link).toHaveAccessibleName(`5 replies: ${FIRST_REPLY}`)
  await expect(link).toContainText(FIRST_REPLY)
  await expect(link).not.toContainText(ROOT)
  await expect(link).not.toContainText('can we live with the quarantine')
  await link.scrollIntoViewIfNeeded()
  await juno.win.screenshot({ path: test.info().outputPath('thread-link-preview-after.png') })
})

syncedTest('unknown first replies show only the count and fill in place when a peek fetch lands', async ({ juno, fake, slack, win }) => {
  await juno.sidebar.row('#eng').open()
  const link = juno.topic.threadLinkUnder(ROOT)
  await expect(link.root).toHaveAccessibleName('5 replies')
  await expect(link.root).toHaveText('5 replies')
  await expect(link.root).not.toContainText(ROOT)
  slack.resetCalls()
  // Local warming and the list do not fetch replies.
  await link.root.hover()
  await win.waitForTimeout(500)
  expect(fake.calls.filter(call => call.method === 'conversations.replies' && call.args['limit'] !== '1')).toEqual([])

  fake.holdNext({ method: 'conversations.replies', reason: 'open' })
  await link.peek()
  await expect.poll(() => fake.heldCount({ method: 'conversations.replies' })).toBe(1)
  await expect(link.root).toHaveAccessibleName('5 replies')
  const root = slack.root(ROOT)
  await expectStableAnchor(win, `[data-topic-view] [data-message-row="${root.ts}"]`, async () => {
    fake.release({ method: 'conversations.replies' })
    await expect(link.root).toHaveAccessibleName(`5 replies: ${FIRST_REPLY}`)
    await juno.peek.expectMessage('Quarantining it. Ticket filed.')
  })
  await juno.peek.release()
})
