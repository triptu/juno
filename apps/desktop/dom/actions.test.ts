// The topic actions against the fake Slack (SPEC 5 "Row actions"): resolve and reopen, pin,
// mark read and unread, ignore and rename, each with its toast, and each undone with the
// toast's Undo or ⌘Z (Edit › Undo).
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'
const RINA = 'Rina finished the onsite'
const ALERTS_MAIN = '#alerts-prod'
const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

// One launch. Marks go first, while Rina's thread still has its 2 unread; each step undoes what it did.
domTest('resolve and reopen with Undo, pinned rows, marks, Ignore and Rename, from the menus', async ({ juno, slack, step }) => {
  const { sidebar } = juno
  await step('Mark as read and Mark as unread from the menu, each undone', () => marks(juno))
  await step('Ignore hides the channel’s topics, and Undo shows them again', () => ignore(juno))
  await step('Rename from a row edits the row, and Undo puts the old title back', () => rename(juno))
  await step('Resolve hides the row and marks it read, Undo brings it back unread, and a new reply reopens it', async () => {
    const roadmap = sidebar.row(ROADMAP)
    await roadmap.expectUnread(3)
    slack.resetCalls()

    // From the row's menu.
    await roadmap.chooseInMenu('resolve')
    await roadmap.expectAbsent()
    await juno.expectToast(`Resolved · ${ROADMAP}`)
    // Resolve marks read in Slack too; it never unfollows.
    await expect.poll(() => slack.fake.calls.some((call) => MARKS.includes(call.method)), { timeout: 10_000 }).toBe(true)
    expect(slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove')).toBe(false)

    await juno.undoFromToast()
    await roadmap.expectVisible()
    await roadmap.expectUnread(3)

    // Resolved again from the row's menu right after Undo: it must offer Resolve, not Reopen, with no waiting.
    const menu = await roadmap.chooseInMenu('resolve')
    expect(menu.labels).toContain('Resolve')
    expect(menu.labels).not.toContain('Reopen')
    // A reply from someone else then brings it back, tagged.
    await roadmap.expectAbsent()
    slack.as('Maya').replyIn(ROADMAP, 'One more thing on the proposal.')
    await roadmap.expectVisible()
    await roadmap.expectTag('Reopened')
  })

  await step('a pinned topic stays in Pinned when resolved, and the header reopens it', async () => {
    const postgres = sidebar.row(POSTGRES)

    await postgres.chooseInMenu('pin')
    await juno.expectToast(`Pinned · ${POSTGRES}`)
    await expect(sidebar.section('Pinned').locator('[data-topic-row]')).toHaveCount(1)
    await postgres.open()

    const header = juno.topic.header
    await header.getByRole('button', { name: 'Resolve' }).click()
    await juno.expectToast(`Resolved · ${POSTGRES}`)
    await postgres.expectResolvedCheck()
    expect(await sidebar.titles('Pinned')).toEqual([expect.stringMatching(/^Draft plan/)])

    // Reopen is the same button now; ⌘Z undoes it.
    await header.getByRole('button', { name: 'Reopen' }).click()
    await juno.expectToast(`Reopened · ${POSTGRES}`)
    await postgres.expectResolvedCheck(false)
    await juno.undo()
    await postgres.expectResolvedCheck()
    await expect(header.getByRole('button', { name: 'Reopen' })).toBeVisible()

    // Unpin, then undo it.
    await postgres.chooseInMenu('unpin')
    await juno.expectToast(`Unpinned · ${POSTGRES}`)
    await sidebar.expectNoSection('Pinned')
    await juno.undo()
    await expect(sidebar.section('Pinned').locator('[data-topic-row]')).toHaveCount(1)
    // And the pin itself: undoing it empties Pinned. The resolve undo goes first.
    await juno.undo()
    await juno.undo()
    await sidebar.expectNoSection('Pinned')
  })
})


async function marks(juno: Juno): Promise<void> {
  const rina = juno.sidebar.row(RINA)
  await rina.expectUnread(2)

  await rina.chooseInMenu('mark-read')
  await juno.expectToast(`Marked as read · ${RINA}`)
  await rina.expectRead()
  await juno.undoFromToast()
  await rina.expectUnread(2)

  const postgres = juno.sidebar.row(POSTGRES)
  await postgres.expectRead()
  await postgres.chooseInMenu('mark-unread')
  await juno.expectToast(`Marked as unread · ${POSTGRES}`)
  await postgres.expectUnread(1)
  await juno.undo()
  await postgres.expectRead()
}

async function ignore(juno: Juno): Promise<void> {
  // A bot channel: the Automated view holds it.
  await juno.sidebar.selectView('Automated')
  const alerts = juno.sidebar.row(ALERTS_MAIN)
  const { labels } = await alerts.chooseInMenu('ignore-channel')
  expect(labels).toContain('Ignore #alerts-prod')
  await alerts.expectAbsent()
  await juno.expectToast('Ignoring #alerts-prod')
  await juno.undo()
  await alerts.expectVisible()
}


async function rename(juno: Juno): Promise<void> {
  const { sidebar } = juno
  // Back from the Automated view the step above chose.
  await sidebar.filter('All')
  // The row: the title becomes a field; Enter saves.
  await sidebar.row(POSTGRES).chooseInMenu('rename')
  await expect(sidebar.list.locator('[data-rename-field]')).toBeVisible()
  await juno.rename('Postgres cutover')
  await juno.expectToast('Renamed · Postgres cutover')
  await sidebar.row('Postgres cutover').expectVisible()
  await juno.undo()
  await sidebar.row(POSTGRES).expectVisible()
}
