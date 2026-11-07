// The sidebar's Reactions view (SPEC 5, "Reactions"): a reaction Juno only
// learns of from Slack's activity feed shows when the view opens; a live one
// from the socket adds its row above it; another reaction on the same
// message updates that row and moves it up instead of adding one; a removed
// reaction updates it; and pressing a row opens the topic at the message.
// That the message flashes in view is the browser lane's, as for Search.
import type { Query } from './query'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const MAIN = 'Shipped the fix for the stuck upload queue'
const REPLY = 'Cutover window works for me'

const part = (row: Element, name: string) => row.querySelector(`[data-row-part="${name}"]`)?.textContent ?? ''

/** The view's rows for this test's two messages, top to bottom, as "who | preview". Seeded reactions may add others. */
const ours = (rows: Query) => () =>
  rows
    .all()
    .map((row) => `${part(row, 'title')} | ${part(row, 'preview')}`)
    .filter((line) => line.endsWith(MAIN) || line.endsWith(REPLY))

domTest('the Reactions view lists reactions to your messages newest first, follows the socket, and opens the message', async ({ juno, fake, slack, step }) => {
  const eng = slack.channel('eng')
  const mainTs = slack.as('Tushar').postIn('eng', MAIN)
  slack.as('Tushar').replyIn(POSTGRES, REPLY)
  const replyTs = fake.messages(eng).find((message) => message.text === REPLY)!.ts
  const pill = juno.sidebar.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: 'Reactions', exact: true })
  const rows = juno.win.locator('[data-reaction-row]')

  await step('a reaction Juno hears of only from Slack’s feed shows when the view opens', async () => {
    // The socket's frame is dropped, so the feed is the only way Juno learns of it.
    fake.holdFrames({ types: ['reaction_added'] })
    fake.addReaction({ channel: eng, ts: mainTs, name: 'tada', user: 'U0MAYA' })
    fake.releaseFrames({ drop: true })
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(ours(rows)).toEqual([`Maya | ${MAIN}`])
  })

  await step('a live reaction adds a row on top; another on the same message updates its row and moves it up; a removal updates it', async () => {
    fake.addReaction({ channel: eng, ts: replyTs, name: '+1', user: 'U0SAM' })
    await expect.poll(ours(rows)).toEqual([`Sam | ${REPLY}`, `Maya | ${MAIN}`])
    fake.addReaction({ channel: eng, ts: mainTs, name: 'eyes', user: 'U0LEO' })
    await expect.poll(ours(rows)).toEqual([`Leo, Maya | ${MAIN}`, `Sam | ${REPLY}`])
    fake.removeReaction({ channel: eng, ts: mainTs, name: 'eyes', user: 'U0LEO' })
    await expect.poll(ours(rows)).toEqual([`Maya | ${MAIN}`, `Sam | ${REPLY}`])
  })

  await step('pressing a reply’s row opens its thread at the message', async () => {
    await rows.filter({ hasText: REPLY }).click()
    await juno.topic.expectTitle(POSTGRES)
    await expect(juno.topic.message(REPLY)).toBeVisible()
  })
})
