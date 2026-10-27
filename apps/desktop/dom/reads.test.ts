// Reading (spec sections 7 and 14): a reply that arrives while the topic is open at the bottom shows and
// counts as read, unless the window is in the background; and read marks in Slack ("Mark messages read in
// Slack too"): on by default, a peek marks nothing and an open marks once; switched off, opening marks
// nothing; switched back on, "Mark earlier reads in Slack" catches up what was read meanwhile. Mark unread
// on a message makes it and everything after it unread and holds while you stay, as the topic's Mark as
// unread does (e2e/mark-unread.spec.ts). Scrolled up, behind "N new messages", is the browser lane's
// (topic.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const SWITCH = 'Mark messages read in Slack too'
const CATCH_UP = 'Mark earlier reads in Slack'
// The Postgres thread's sixth and seventh messages (its root, five replies, then this one).
const SIXTH = 'Thursday works'
const SEVENTH = 'Booked 2–4pm'
// Longer than every read timer and observer in the topic view.
const STAY_MS = 3_000

domTest('live replies keep an open topic read unless the window is behind, a peek marks nothing, and marks in Slack switch off and catch up', async ({ juno, slack, step }) => {
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
    // Its mark reaches Slack before the next step counts marks.
    await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.mark'), { timeout: 10_000 }).toBe(true)
  })

  await step('a peek marks nothing, an open marks once, switched off nothing is marked, and catching up marks earlier reads', async () => {
    const marks = () => slack.fake.calls.filter((call) => call.method === 'conversations.mark' || call.method === 'subscriptions.thread.mark')
    slack.fake.resetCalls()
    await juno.sidebar.row(RINA).peek()
    await juno.peek.expectShowing(RINA)
    await juno.peek.expectMessage('Strong systems design')
    await juno.peek.release()
    await juno.peek.expectClosed()
    expect(marks()).toHaveLength(0)

    await juno.sidebar.row(RINA).open()
    await juno.sidebar.row(RINA).expectRead()
    await expect.poll(() => marks().length).toBe(1)
    await juno.openSettings('General')
    const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    slack.fake.resetCalls()
    await juno.sidebar.row(ROADMAP).open()
    await juno.sidebar.row(ROADMAP).expectRead()
    await juno.openSettings('General')
    await expect(toggle).not.toBeChecked()
    expect(marks()).toHaveLength(0)
    await toggle.check()
    slack.fake.holdNext({ method: 'subscriptions.thread.mark' })
    await juno.settings.root.getByRole('button', { name: CATCH_UP }).click()
    await expect(juno.settings.root.getByText(/Marking earlier reads in Slack/)).toBeVisible()
    slack.fake.release({ method: 'subscriptions.thread.mark' })
    await expect.poll(() => marks().length).toBe(1)
    await expect(juno.settings.root.getByRole('button', { name: CATCH_UP })).toHaveCount(0)
    await expect(juno.settings.root.getByText(/Marking earlier reads in Slack/)).toHaveCount(0)
    await expect(juno.settings.root.getByText('Earlier reads are in Slack')).toBeVisible()
  })
})

domTest('Mark unread on a message makes it and the rest unread, holds while you stay, and Undo puts the read state back', async ({ juno, slack, clock, step }) => {
  const postgres = juno.sidebar.row(POSTGRES)
  const { topic } = juno
  // Ten messages: the seed's seven, then three more, one mentioning you. Opened, left and opened again, it is read with no divider.
  slack.as('Leo').replyIn(POSTGRES, 'Replica sizing is in the doc.')
  slack.as('Dev').replyIn(POSTGRES, '<@U0TUSHAR> the dry run is green, can you sign off?')
  slack.as('Leo').replyIn(POSTGRES, 'Cutover is Tuesday at 9.')
  const root = slack.root(POSTGRES)
  const replies = slack.fake.workspace.replies(root.channel, root.ts)
  const tsOf = (text: string) => replies.find((reply) => reply.text?.startsWith(text))?.ts
  const slackPointer = () => slack.fake.workspace.subscription(root.channel, root.ts)?.lastRead
  const tenth = replies.at(-1)?.ts
  const firstNew = topic.root.locator('[data-new-divider] + [data-message-row]')
  await postgres.open()
  await topic.expectMessage('Cutover is Tuesday at 9.')
  await juno.sidebar.row(RINA).open()
  await topic.expectTitle(RINA)
  await postgres.open()
  await topic.expectMessage('Cutover is Tuesday at 9.')
  await postgres.expectRead()
  await expect.poll(() => slackPointer()).toBe(tenth)
  await expect(topic.root.locator('[data-new-divider]')).toHaveCount(0)

  await step('Mark unread on the seventh: the divider is before it, four unread with the mention, and Slack reads to the sixth', async () => {
    await topic.chooseInMessageMenu(SEVENTH, 'mark-unread')
    await juno.expectToast('Marked unread')
    await postgres.expectUnread(4)
    await postgres.expectMention()
    await expect(firstNew).toContainText(SEVENTH)
    await expect(topic.root.locator('[data-new-divider]')).toHaveText('4 new')
    await expect.poll(() => slackPointer()).toBe(tsOf(SIXTH))
  })

  await step('staying at the bottom, with the window losing and regaining focus, leaves it unread', async () => {
    slack.resetCalls()
    await juno.blurWindow()
    await juno.focusWindow()
    await clock.fastForward(STAY_MS)
    await slack.expectNoMarks()
    await postgres.expectUnread(4)
  })

  await step('Undo puts it back as it was: read, with no divider, here and in Slack', async () => {
    await juno.undoFromToast()
    await postgres.expectRead()
    await expect(topic.root.locator('[data-new-divider]')).toHaveCount(0)
    await expect.poll(() => slackPointer()).toBe(tenth)
  })

  await step('U on the seventh does the same, and leaving and coming back marks it read', async () => {
    await topic.message(SEVENTH).press('u')
    await postgres.expectUnread(4)
    await expect(firstNew).toContainText(SEVENTH)
    await expect.poll(() => slackPointer()).toBe(tsOf(SIXTH))
    await juno.sidebar.row(RINA).open()
    await topic.expectTitle(RINA)
    await postgres.open()
    await postgres.expectRead()
    await expect.poll(() => slackPointer()).toBe(tenth)
  })
}, { clock: true })
