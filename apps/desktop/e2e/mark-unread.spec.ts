// Mark as unread on the topic you are viewing (SPEC 7, "Mark as unread"):
// it stays unread, with its "N new" line and count, until you leave the
// topic and come back, mark it read or send in it. Nothing marks it read
// while you stay, here or in Slack.
import type { CallRecord } from '@juno/fake-slack'
import { expect, test } from './fixtures'


// Starts signed in and synced (README, "Synced start").
test.use({ synced: true, freshContext: true })

test.describe.configure({ timeout: 90_000 })

test.beforeEach(async ({ win }) => { await win.clock.install() })

// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

// Longer than every read timer and observer in the topic view.
const STAY_MS = 3_000

const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

/** The last read mark Slack received: a thread's says `read` 0 or 1, a Main's only its `ts`. */
const lastMark = (calls: ReadonlyArray<CallRecord>) => calls.filter((call) => MARKS.includes(call.method)).at(-1)?.args

/** The last read mark Slack received for #eng's Main. */
const lastEngMark = (calls: ReadonlyArray<CallRecord>) => calls.filter((call) => call.method === 'conversations.mark' && call.args['channel'] === 'C0ENG').at(-1)?.args

test('Mark as unread holds on the open topic: a thread until you leave it, a Main until you send in it', async ({ juno, slack, win }) => {
  await test.step('a thread marked unread while open stays unread until you leave it', async () => {
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
    await win.clock.fastForward(STAY_MS)
    await juno.blurWindow()
    await juno.focusWindow()
    slack.as('Maya').replyIn(RINA, 'Happy to join the close call too.')
    await juno.topic.expectMessage('Happy to join the close call too.')
    await rina.expectUnread(2)
    await win.clock.fastForward(STAY_MS)
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
    await win.clock.fastForward(STAY_MS)
    await rina.expectUnread(1)
    expect(lastMark(slack.fake.calls)?.read).toBe('0')
  })

  // Leaving the thread while it is unread leaves it unread; only #eng's marks count from here.
  await test.step('a Main marked unread from the palette stays unread until you send in it', async () => {
    const eng = juno.sidebar.row(ENG_MAIN)
    await eng.open()
    await eng.expectRead()
    await expect.poll(() => lastEngMark(slack.fake.calls)?.ts).toBeDefined()
    const read = lastEngMark(slack.fake.calls)?.ts

    const { palette } = juno
    await palette.open()
    await palette.type('Mark as unread')
    await palette.expectResults()
    await palette.section('Pages, settings and commands').getByRole('option', { name: 'Mark as unread' }).click()
    await eng.expectUnread(1)
    // The pointer moves back to the message before the latest.
    await expect.poll(() => lastEngMark(slack.fake.calls)?.ts).not.toBe(read)
    const unread = lastEngMark(slack.fake.calls)?.ts ?? ''
    expect(unread < (read ?? '')).toBe(true)
    await win.clock.fastForward(STAY_MS)
    await eng.expectUnread(1)
    expect(lastEngMark(slack.fake.calls)?.ts).toBe(unread)

    // Your own message marks it read.
    await juno.topic.send('Looking into the migration now')
    await eng.expectRead()
    await expect.poll(() => (lastEngMark(slack.fake.calls)?.ts ?? '') > unread).toBe(true)
  })
})
