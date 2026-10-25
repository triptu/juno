import { expect, syncedTest } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

const ROOT = 'checkout.spec failed again on main.'
const FIRST_REPLY = 'Sam: Quarantining it. Ticket filed.'

// That the link draws its first reply and repliers is in the DOM lane (`dom/thread-link-preview.test.ts`); here, it fills in place.
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
