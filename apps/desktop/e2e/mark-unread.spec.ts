// Mark as unread on the topic you are viewing (SPEC 7, "Mark as unread"):
// it stays unread, with its "N new" line and count, until you leave the
// topic and come back, mark it read or send in it. Nothing marks it read
// while you stay, here or in Slack.
import type { CallRecord } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const POSTGRES = 'Draft plan is in the doc'
const ALERTS_MAIN = '#alerts-prod'

// Longer than every read timer and observer in the topic view.
const STAY_MS = 3_000

const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

/** The last read mark Slack received: a thread's says `read` 0 or 1, a Main's only its `ts`. */
const lastMark = (calls: ReadonlyArray<CallRecord>) => calls.filter((call) => MARKS.includes(call.method)).at(-1)?.args

test('a thread marked unread while open stays unread until you leave it', async ({ juno, slack, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rina = juno.sidebar.row(RINA)
  await rina.open()
  await rina.expectRead()
  await expect.poll(() => lastMark(slack.fake.calls)?.read).toBe('1')

  // From the header's ⋯: the latest reply is unread, with the line above it.
  await juno.topic.chooseInMenu('mark-unread')
  await juno.expectToast(`Marked as unread · ${RINA}`)
  await rina.expectUnread(1)
  await expect(juno.topic.root.locator('[data-new-divider] + [data-message-row]')).toContainText('competing offer')
  await expect.poll(() => lastMark(slack.fake.calls)?.read).toBe('0')

  // Staying, losing and regaining focus, and a new reply leave it unread.
  await win.waitForTimeout(STAY_MS)
  await juno.blurWindow()
  await juno.focusWindow()
  slack.as('Maya').replyIn(RINA, 'Happy to join the close call too.')
  await juno.topic.expectMessage('Happy to join the close call too.')
  await rina.expectUnread(2)
  await win.waitForTimeout(STAY_MS)
  await rina.expectUnread(2)
  expect(lastMark(slack.fake.calls)?.read).toBe('0')

  // Leaving and coming back marks it read.
  await juno.sidebar.row(POSTGRES).open()
  await rina.open()
  await rina.expectRead()
  await expect.poll(() => lastMark(slack.fake.calls)?.read).toBe('1')

  // The same from the sidebar row's menu while the topic is open.
  await rina.chooseInMenu('mark-unread')
  await rina.expectUnread(1)
  await expect.poll(() => lastMark(slack.fake.calls)?.read).toBe('0')
  await win.waitForTimeout(STAY_MS)
  await rina.expectUnread(1)
  expect(lastMark(slack.fake.calls)?.read).toBe('0')
})

test('a Main marked unread from the palette stays unread until you send in it', async ({ juno, slack, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const alerts = juno.sidebar.row(ALERTS_MAIN)
  await alerts.open()
  await alerts.expectRead()
  await expect.poll(() => lastMark(slack.fake.calls)?.ts).toBeDefined()
  const read = lastMark(slack.fake.calls)?.ts

  const { palette } = juno
  await palette.open()
  await palette.type('Mark as unread')
  await palette.choose('Mark as unread')
  await alerts.expectUnread(1)
  // The pointer moves back to the message before the latest.
  await expect.poll(() => lastMark(slack.fake.calls)?.ts).not.toBe(read)
  const unread = lastMark(slack.fake.calls)?.ts ?? ''
  expect(unread < (read ?? '')).toBe(true)
  await win.waitForTimeout(STAY_MS)
  await alerts.expectUnread(1)
  expect(lastMark(slack.fake.calls)?.ts).toBe(unread)

  // Your own message marks it read.
  await juno.topic.send('Looking into the alerts now')
  await alerts.expectRead()
  await expect.poll(() => (lastMark(slack.fake.calls)?.ts ?? '') > unread).toBe(true)
})
