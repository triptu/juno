// The topic actions against the fake Slack (SPEC 5 "Row actions", inventory
// 15 and 16): resolve and reopen, pin, rename, ignore, mark read and
// unread, Copy Slack link and Open in Slack, each with its toast, and each
// undone with the toast's Undo or ⌘Z (Edit › Undo).
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const ALERTS_MAIN = '#alerts-prod'

const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

test('Resolve hides the row and marks it read, Undo brings it back unread, and a new reply reopens it', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const roadmap = juno.sidebar.row(ROADMAP)
  await roadmap.expectUnread(3)
  slack.resetCalls()

  // The hover check.
  await roadmap.hover()
  await roadmap.resolveButton.click()
  await roadmap.expectAbsent()
  await juno.expectToast(`Resolved · ${ROADMAP}`)
  // Resolve marks read in Slack too; it never unfollows.
  await expect.poll(() => slack.fake.calls.some((call) => MARKS.includes(call.method)), { timeout: 10_000 }).toBe(true)
  expect(slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove')).toBe(false)

  await juno.undoFromToast()
  await roadmap.expectVisible()
  await roadmap.expectUnread(3)

  // Resolved again from the menu, then a reply from someone else brings it back, tagged.
  await roadmap.chooseInMenu('resolve')
  await roadmap.expectAbsent()
  slack.as('Maya').replyIn(ROADMAP, 'One more thing on the proposal.')
  await roadmap.expectVisible()
  await roadmap.expectTag('Reopened')
})

test('a pinned topic stays in Pinned when resolved, and the header reopens it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
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

test('Rename from a row edits the row, from the header edits the header, and clearing a title brings the old one back', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno

  // The row: the title becomes a field with its text selected; Enter saves.
  await sidebar.row(POSTGRES).chooseInMenu('rename')
  await expect(sidebar.list.locator('[data-rename-field]')).toBeVisible()
  const selection = await juno.renameField.evaluate((field: HTMLInputElement) => ({ start: field.selectionStart, end: field.selectionEnd, length: field.value.length }))
  expect(selection.start).toBe(0)
  expect(selection.end).toBe(selection.length)
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
})

test('Ignore hides the channel’s topics, and Undo shows them again', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  // A bot channel: the Automated view holds it.
  await juno.sidebar.selectView('Automated')
  const alerts = juno.sidebar.row(ALERTS_MAIN)
  const { labels } = await alerts.chooseInMenu('ignore-channel')
  expect(labels).toContain('Ignore #alerts-prod')
  await alerts.expectAbsent()
  await juno.expectToast('Ignoring #alerts-prod')
  await juno.undo()
  await alerts.expectVisible()
})

test('Mark as read and Mark as unread from the menu, each undone', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('Copy Slack link and Open in Slack from a row and from a message', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const postgres = juno.sidebar.row(POSTGRES)

  await postgres.chooseInMenu('copy-link')
  await expect.poll(() => juno.clipboard()).toMatch(/\/archives\/C0ENG\/p\d+$/)
  await postgres.chooseInMenu('open-in-slack')
  await expect.poll(() => juno.slackLinks()).toEqual([expect.stringMatching(/^slack:\/\/channel\?team=T0JUNO&id=C0ENG$/)])

  // A reply's link carries its thread.
  await postgres.open()
  const reply = juno.topic.message('Booked 2–4pm')
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.chooseNextMenuItem('copy-link')
  await reply.click({ button: 'right' })
  await expect.poll(() => juno.clipboard()).toMatch(/\/archives\/C0ENG\/p\d+\?thread_ts=\d+\.\d+&cid=C0ENG$/)
  await juno.chooseNextMenuItem('open-in-slack')
  await reply.click({ button: 'right' })
  await expect.poll(async () => (await juno.slackLinks()).length).toBe(2)
})
