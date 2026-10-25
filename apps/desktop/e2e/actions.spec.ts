// The topic actions against the fake Slack (SPEC 5 "Row actions", inventory
// 15 and 16): rename, ignore, mark read and unread, Copy Slack link and Open
// in Slack, each with its toast, and each undone with the toast's Undo or ⌘Z
// (Edit › Undo). Resolve, reopen and pin are in the DOM lane
// (`dom/actions.test.ts`).
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ALERTS_MAIN = '#alerts-prod'

// Each step undoes what it did. Marks go first, while Rina's thread still has its 2 unread.
test('Mark as read and unread, Ignore, the Slack links and Rename, each from the menu', async ({ juno }) => {
  await test.step('Mark as read and Mark as unread from the menu, each undone', async () => {
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

  await test.step('Ignore hides the channel’s topics, and Undo shows them again', async () => {
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

  await test.step('Copy Slack link and Open in Slack from a row and from a message', async () => {
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
  })

  await test.step('Rename from a row edits the row, from the header edits the header, and clearing a title brings the old one back', async () => {
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
})
