// The topic actions against the fake Slack (SPEC 5 "Row actions"): resolve and reopen, pin,
// rename, ignore, mark read and unread, Copy Slack link and Open in Slack, each with its toast,
// and each undone with the toast's Undo or ⌘Z (Edit › Undo).
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'
const RINA = 'Rina finished the onsite'
const ALERTS_MAIN = '#alerts-prod'
const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

domTest('resolves and reopens topics, with Undo and pinned rows', async ({ juno, slack, step }) => {
  const { sidebar } = juno
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

// Each step undoes what it did. Marks go first, while Rina's thread still has its 2 unread.
domTest('Mark as read and unread, Ignore, the Slack links and Rename, each from the menu', async ({ juno, step }) => {
  await step('Mark as read and Mark as unread from the menu, each undone', () => marks(juno))
  await step('Ignore hides the channel’s topics, and Undo shows them again', () => ignore(juno))
  await step('Copy Slack link and Open in Slack from a row and from a message', () => slackLinks(juno))
  await step('Rename from a row edits the row, from the header edits the header, and clearing a title brings the old one back', () => rename(juno))
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

async function slackLinks(juno: Juno): Promise<void> {
  // Back from the Automated view the step above chose.
  await juno.sidebar.filter('All')
  const postgres = juno.sidebar.row(POSTGRES)

  await postgres.chooseInMenu('copy-link')
  await expect.poll(() => juno.clipboard()).toMatch(/\/archives\/C0ENG\/p\d+$/)
  const topicLink = await juno.clipboard()
  await postgres.chooseInMenu('open-in-slack')
  await expect.poll(() => juno.slackLinks()).toEqual([expect.stringMatching(/^slack:\/\/channel\?team=T0JUNO&id=C0ENG$/)])

  // A message's Open in Slack opens its channel; Copy Slack link at its end copies the message's own link. A reply's
  // carries its thread's root, as Slack builds it; the root's is the thread's link.
  await postgres.open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.topic.chooseInMessageMenu('Booked 2–4pm', 'open-in-slack')
  await expect.poll(async () => (await juno.slackLinks()).length).toBe(2)
  await juno.topic.chooseInMessageMenu('Booked 2–4pm', 'copy-link')
  const rootTs = /p(\d+)(\d{6})$/.exec(topicLink)!.slice(1).join('.')
  await expect.poll(() => juno.clipboard()).toMatch(new RegExp(`/archives/C0ENG/p\\d+\\?thread_ts=${rootTs.replace('.', '\\.')}&cid=C0ENG$`))
  expect(await juno.clipboard()).not.toBe(topicLink)
  await juno.topic.chooseInMessageMenu(POSTGRES, 'copy-link')
  await expect.poll(() => juno.clipboard()).toBe(topicLink)
}

async function rename(juno: Juno): Promise<void> {
  const { sidebar } = juno

  // The row: the title becomes a field with its text selected; Enter saves.
  await sidebar.row(POSTGRES).chooseInMenu('rename')
  await expect(sidebar.list.locator('[data-rename-field]')).toBeVisible()
  const field = (await juno.renameField.element()) as HTMLInputElement
  expect(field.selectionStart).toBe(0)
  expect(field.selectionEnd).toBe(field.value.length)
  await juno.rename('Postgres cutover')
  await juno.expectToast('Renamed · Postgres cutover')
  const renamed = sidebar.row('Postgres cutover')
  await renamed.expectVisible()
  await juno.undo()
  await sidebar.row(POSTGRES).expectVisible()

  // Esc cancels.
  await sidebar.row(POSTGRES).chooseInMenu('rename')
  await juno.renameField.press('Escape')
  await expect(juno.renameField).toHaveCount(0)
  await sidebar.row(POSTGRES).expectVisible()

  // The header: Rename in the title menu turns the title into a field in place.
  await sidebar.row(POSTGRES).open()
  await juno.topic.chooseInMenu('rename')
  await expect(juno.topic.header.locator('[data-rename-field]')).toBeVisible()
  await juno.rename('Postgres 16 migration')
  await juno.topic.expectTitle('Postgres 16 migration')
  await sidebar.row('Postgres 16 migration').expectVisible()

  // An empty title clears the manual one; Undo puts it back.
  await juno.topic.chooseInMenu('rename')
  await juno.rename('')
  await juno.expectToast('Title cleared')
  await juno.topic.expectTitle(POSTGRES)
  await juno.undoFromToast()
  await juno.topic.expectTitle('Postgres 16 migration')
}
