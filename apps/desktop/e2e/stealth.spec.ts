// Stealth: a topic opened from the row menu's "Open in stealth" is never
// marked read, here or in Slack, until its Mark read.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

const RINA = 'Rina finished the onsite.'

test('a stealth tab keeps the topic unread and sends no mark; Mark read ends stealth', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rina = juno.sidebar.row(RINA)
  await rina.expectUnread(2)
  slack.resetCalls()

  await rina.openInStealth()
  await juno.tabs.expectStealth(RINA)
  await juno.topic.expectStealth()
  await juno.topic.expectNew(2)
  // At the bottom, in a focused window, and a reply arrives: still nothing is marked.
  slack.as('Sam').replyIn(RINA, 'Offer call is booked for 10am')
  await juno.topic.expectMessage('Offer call is booked for 10am')
  await rina.expectUnread(3)
  await slack.expectNoMarks()

  // From the keyboard: the button goes away, and focus moves on to the bell rather than the top of the window.
  await juno.topic.markReadWithKeyboard()
  await expect(juno.topic.bell).toBeFocused()
  await rina.expectRead()
  await juno.tabs.expectStealth(RINA, false)
  await juno.topic.expectStealth(false)
})
