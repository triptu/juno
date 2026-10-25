import { expect, syncedTest } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

const ROOT = 'checkout.spec failed again on main.'
const FIRST_REPLY = 'Sam: Quarantining it. Ticket filed.'

// Which reply previews and which repliers show is engine data (message-content.flow.test.ts); this checks the link draws them.
syncedTest('Main draws the thread link with its first reply and repliers once the thread is opened', async ({ juno }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.threadLinkUnder(ROOT).open()
  await juno.topic.expectMessage('Quarantining it. Ticket filed.')
  await juno.sidebar.row('#eng').open()
  const link = juno.topic.threadLinkUnder(ROOT).root
  await expect(link).toHaveAccessibleName(`5 replies: ${FIRST_REPLY}`)
  await expect(link).toContainText(FIRST_REPLY)
  const avatars = link.locator('[data-kind="person"]')
  await expect(avatars).toHaveCount(2)
  expect(await avatars.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Sam', 'Dev'])
  // The avatars stand in for the speech bubble, with no extra counter.
  await expect(link).not.toContainText('+')
  await expect(link.locator('svg')).toHaveCount(1)
})

syncedTest('unknown first replies show only the count and fill in place when a peek fetch lands', async ({ juno, fake, slack, win }) => {
  await juno.sidebar.row('#eng').open()
  const link = juno.topic.threadLinkUnder(ROOT)
  await expect(link.root).toHaveAccessibleName('5 replies')
  await expect(link.root).toContainText('5 replies')
  await expect(link.root).not.toContainText(ROOT)
  slack.resetCalls()
  // Local warming and the list do not fetch replies.
  await link.root.hover()
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
