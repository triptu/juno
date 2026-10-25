// Main's thread link (SPEC 7, "Main"): once the thread is opened it draws its first reply and
// the repliers in place of the speech bubble. Which reply previews and which repliers show is
// engine data (message-content.flow.test.ts); this checks the link draws them.
import { expect } from './expect'
import { domTest } from './test'

const ROOT = 'checkout.spec failed again on main.'
const FIRST_REPLY = 'Sam: Quarantining it. Ticket filed.'

domTest('Main draws the thread link with its first reply and repliers once the thread is opened', async ({ juno }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.threadLinkUnder(ROOT).open()
  await juno.topic.expectMessage('Quarantining it. Ticket filed.')
  await juno.sidebar.row('#eng').open()
  const link = juno.topic.threadLinkUnder(ROOT).root
  await expect(link).toHaveAccessibleName(`5 replies: ${FIRST_REPLY}`)
  await expect(link).toContainText(FIRST_REPLY)
  const avatars = link.locator('[data-kind="person"]')
  await expect(avatars).toHaveCount(2)
  expect(avatars.all().map((node) => node.getAttribute('aria-label'))).toEqual(['Sam', 'Dev'])
  // The avatars stand in for the speech bubble, with no extra counter.
  await expect(link).not.toContainText('+')
  await expect(link.locator('svg')).toHaveCount(1)
})
