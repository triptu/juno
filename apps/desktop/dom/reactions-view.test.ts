// The sidebar's Reactions view (SPEC 5, "Reactions"), one row per message as
// Slack's Activity lists them: a reaction Juno only learns of from Slack's
// activity feed shows when the view opens, even below a newer live one; a
// live reaction makes its reactor the row's headline and moves it up; "+N"
// counts the others who reacted now; another pill puts the topics back and
// the feed is read again when the view reopens; and pressing a row opens the
// topic at the message. That the message flashes in view is the browser
// lane's, as for Search.
import type { Query } from './query'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const MAIN = 'Shipped the fix for the stuck upload queue'
const REPLY = 'Cutover window works for me'
const ROOT = 'Release checklist for Friday'
const OLD_REPLY = 'Docs are updated for the release'
const OLD_MAIN = 'Roadmap draft is ready for comments'

const part = (row: Element, name: string) => row.querySelector(`[data-row-part="${name}"]`)?.textContent ?? ''

/** The view's rows for `texts`, top to bottom, as "who | preview". Seeded reactions may add others. */
const ours = (rows: Query, texts: ReadonlyArray<string> = [MAIN, REPLY]) => () =>
  rows
    .all()
    .map((row) => `${part(row, 'title')} | ${part(row, 'preview')}`)
    .filter((line) => texts.some((text) => line.endsWith(text)))

domTest('the Reactions view lists reactions to your messages newest first, follows the socket, and opens the message', async ({ juno, fake, slack, step }) => {
  const eng = slack.channel('eng')
  const mainTs = slack.as('Tushar').postIn('eng', MAIN)
  slack.as('Tushar').replyIn(POSTGRES, REPLY)
  const replyTs = fake.messages(eng).find((message) => message.text === REPLY)!.ts
  const pills = juno.sidebar.root.getByRole('group', { name: 'Quick filters' })
  const pill = pills.getByRole('button', { name: 'Reactions', exact: true })
  const rows = juno.win.locator('[data-reaction-row]')

  await step('a reaction Juno hears of only from Slack’s feed shows when the view opens, below a newer live one', async () => {
    // The socket's frame is dropped, so the feed is the only way Juno learns of it.
    fake.holdFrames({ types: ['reaction_added'] })
    fake.addReaction({ channel: eng, ts: mainTs, name: 'tada', user: 'U0MAYA' })
    fake.releaseFrames({ drop: true })
    // A later reaction arrives on the socket while the view is closed, so the feed's newest entry is already stored.
    fake.addReaction({ channel: eng, ts: replyTs, name: '+1', user: 'U0SAM' })
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(ours(rows)).toEqual([`Sam | ${REPLY}`, `Maya | ${MAIN}`])
  })

  await step('a live reaction makes its reactor the headline and moves the row up; "+N" counts the others who reacted now', async () => {
    fake.addReaction({ channel: eng, ts: replyTs, name: 'eyes', user: 'U0LEO' })
    await expect.poll(ours(rows)).toEqual([`Leo +1 | ${REPLY}`, `Maya | ${MAIN}`])
    fake.removeReaction({ channel: eng, ts: replyTs, name: '+1', user: 'U0SAM' })
    await expect.poll(ours(rows)).toEqual([`Leo | ${REPLY}`, `Maya | ${MAIN}`])
  })

  await step('another pill puts the topics back, and the feed is read again when the view reopens', async () => {
    await juno.sidebar.filter('Channels')
    await expect(rows).toHaveCount(0)
    // A while on the topics: a new message reaches the list, long after the view's subscription was let go.
    slack.as('Maya').postIn('eng', 'Lunch order goes in at noon')
    await expect(juno.sidebar.root.getByText('Lunch order goes in at noon')).toBeVisible()
    fake.holdFrames({ types: ['reaction_added'] })
    fake.addReaction({ channel: eng, ts: mainTs, name: 'raised_hands', user: 'U0PRIYA' })
    fake.releaseFrames({ drop: true })
    await pill.click()
    await expect.poll(ours(rows)).toEqual([`Priya | ${MAIN}`, `Leo | ${REPLY}`])
  })

  await step('pressing a reply’s row opens its thread at the message', async () => {
    await rows.filter({ hasText: REPLY }).click()
    await juno.topic.expectTitle(POSTGRES)
    await expect(juno.topic.message(REPLY)).toBeVisible()
  })
})

domTest('the Reactions view reads messages Juno never stored, one at a time, and leaves out channels you left', async ({ juno, fake, slack, step }) => {
  const eng = slack.channel('eng')
  const product = slack.channel('product')
  // Posted days ago with no event, so Juno's cache holds neither the thread nor the message.
  const at = fake.now() - 2 * 24 * 60 * 60 * 1000
  const rootTs = fake.workspace.post({ channel: eng, user: 'U0MAYA', text: ROOT, at, silent: true }).ts
  const replyTs = fake.workspace.post({ channel: eng, user: 'U0TUSHAR', text: OLD_REPLY, threadTs: rootTs, at: at + 1000, silent: true }).ts
  const mainTs = fake.workspace.post({ channel: product, user: 'U0TUSHAR', text: OLD_MAIN, at: at + 2000, silent: true }).ts
  const rows = juno.win.locator('[data-reaction-row]')
  const texts = [OLD_REPLY, OLD_MAIN]

  await step('one message failing to load does not stop the next, and a reply comes with its thread', async () => {
    // The newest row's message fails every attempt; the thread's own root lookup waits, so its title can only come with the reply.
    fake.force429({ method: 'conversations.replies', retryAfter: 0, times: 3, where: { ts: mainTs } })
    fake.holdNext({ method: 'conversations.replies', reason: 'root', times: 5 })
    fake.addReaction({ channel: eng, ts: replyTs, name: '+1', user: 'U0SAM' })
    fake.advanceClock({ millis: 1000 })
    fake.addReaction({ channel: product, ts: mainTs, name: 'tada', user: 'U0LEO' })
    await juno.sidebar.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: 'Reactions', exact: true }).click()
    await expect.poll(ours(rows, texts)).toEqual([`Sam | ${OLD_REPLY}`])
    await expect(rows.filter({ hasText: OLD_REPLY }).locator('[data-row-part="thread"]')).toHaveText(ROOT)
  })

  await step('after a reconnect the failed message is asked for again', async () => {
    fake.dropSocket()
    await expect.poll(ours(rows, texts)).toEqual([`Leo | ${OLD_MAIN}`, `Sam | ${OLD_REPLY}`])
  })

  await step('leaving a channel takes its rows out; a row goes once no one else has a reaction left', async () => {
    fake.leaveChannel({ channel: product })
    await expect.poll(ours(rows, texts)).toEqual([`Sam | ${OLD_REPLY}`])
    fake.removeReaction({ channel: eng, ts: replyTs, name: '+1', user: 'U0SAM' })
    await expect.poll(ours(rows, texts)).toEqual([])
    fake.release({ method: 'conversations.replies' })
  })
})
