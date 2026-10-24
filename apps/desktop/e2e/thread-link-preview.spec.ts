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
  await expect(link.locator('[data-kind="person"]')).toHaveCount(2)
  expect(await link.locator('[data-kind="person"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Sam', 'Dev'])
  await expect(link).not.toContainText(ROOT)
  await expect(link).not.toContainText('can we live with the quarantine')
  await link.scrollIntoViewIfNeeded()
  for (const theme of ['Light', 'Dark'] as const) {
    await juno.setTheme(theme)
    await juno.sidebar.row('#eng').open()
    await link.scrollIntoViewIfNeeded()
    await juno.win.screenshot({ path: test.info().outputPath(`thread-link-avatars-${theme.toLowerCase()}.png`) })
  }
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

syncedTest('Main shows only the first three reply_users in their Slack order without an extra counter', async ({ juno, slack }) => {
  await juno.sidebar.row('#eng').open()
  slack.as('Maya').replyIn(ROOT, 'I will check the frame load.')
  slack.as('Leo').replyIn(ROOT, 'I can take the ticket.')
  const link = juno.topic.threadLinkUnder(ROOT).root
  await expect(link).toHaveAccessibleName('7 replies')
  const avatars = link.locator('[data-kind="person"]')
  await expect(avatars).toHaveCount(3)
  expect(await avatars.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Sam', 'Dev', 'Maya'])
  await expect(link).not.toContainText('+')
  await expect(link.locator('svg')).toHaveCount(1)
})

for (const repliers of [undefined, []]) {
  test(`Main keeps the speech bubble when reply_users is ${repliers === undefined ? 'unknown' : 'empty'}`, async ({ juno, fake, slack }) => {
    const root = slack.root(ROOT)
    fake.workspace.messages.set(root.channel, fake.messages(root.channel)
      // Keep a history-only root whose replies and replier metadata are unavailable.
      .filter(message => message.thread_ts !== root.ts || message.ts === root.ts)
      .map(message => {
      if (message.ts !== root.ts) return message
      const { reply_users: _repliers, ...rest } = message
      const counted = { ...rest, thread_ts: message.ts, reply_count: 5 }
      return repliers === undefined ? counted : { ...counted, reply_users: repliers }
    }))
    await juno.signIn()
    await juno.waitForSync()
    await juno.sidebar.row('#eng').open()
    const link = juno.topic.threadLinkUnder(ROOT).root
    await expect(link).toHaveAccessibleName('5 replies')
    await expect(link.locator('[data-kind="person"]')).toHaveCount(0)
    await expect(link.locator('svg')).toHaveCount(2)
  })
}
