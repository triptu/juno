// Automated's record (SPEC 5 "Automated", 12 "Automated's record") against
// the fake Slack: a bot channel joined after the first sync moves by itself
// and Home's card explains it with the counts that decided; Move back puts it
// in All and Undo gives it back to Automated, and Dismiss sees the card
// without opening the record. Which channels move in and out, and the reasons
// the record gives, are the engine's sidebar flow test.
import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 120_000 })

const CI_BUILDS = '#ci-builds'
const POSTGRES = 'Draft plan is in the doc'

/** Home is live; stay on it so a card shown once is not lost by opening another visit. */
async function homeShowsRecord(juno: Juno): Promise<void> {
  await juno.home.open()
  await expect.poll(() => juno.home.kinds(), { timeout: 30_000 }).toContain('automatedMoves')
}

syncedTest('a bot channel joined later moves by itself, the card says why, and Move back works with Undo', async ({ juno, fake }) => {
  const { home, sidebar } = juno

  // The first sync's own sorting is setting up, not news.
  await home.open()
  expect(await home.kinds()).not.toContain('automatedMoves')

  fake.workspace.addConversation({ id: 'C0CIBUILDS', name: 'ci-builds', kind: 'public', members: new Set(['U0DEPLOYBOT']), created: fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
  fake.joinChannel({ channel: 'C0CIBUILDS' })
  for (let n = 1; n <= 6; n++) fake.injectMessage({ channel: 'C0CIBUILDS', user: 'U0DEPLOYBOT', text: `main #${n} passed` })

  await homeShowsRecord(juno)
  await expect(home.title('automatedMoves')).toHaveText('Juno moved 1 channel to Automated')
  await expect(home.meta('automatedMoves')).toHaveText('ci-builds')
  // Home's card can come before the sidebar's list says the channel left, and opening a row to read Home afresh held
  // the list: wait until the sidebar shows the move, so the sheet's hold starts from it.
  await sidebar.row(CI_BUILDS).expectAbsent()

  // Dismiss sees the moves without opening the record; the row stays while Home is on screen, without its button.
  await home.button('automatedMoves', 'Dismiss').click()
  await expect(home.button('automatedMoves', 'Dismiss')).toHaveCount(0)

  const sheet = await home.reviewOf('automatedMoves', 'automated')
  await expect(sheet.title).toHaveText('Juno moved 1 channel to Automated')
  await expect(sheet.reason(CI_BUILDS)).toHaveText('Apps wrote 6 of the last 6 top-level messages')
  await sheet.about.click()
  await expect(sheet.explainer).toContainText('Nothing changes in Slack.')
  // The info covers the top of the list; the button closes it again.
  await sheet.about.click()

  await sheet.act(CI_BUILDS).click()
  await juno.expectToast('Moved #ci-builds back to All')
  await expect(sheet.outcome(CI_BUILDS)).toHaveText('Moved back')
  // The sidebar holds behind the sheet (SPEC 5): the channel comes to All when the sheet closes.
  await sidebar.row(CI_BUILDS).expectAbsent()

  // Undo on the row gives the channel back to Automated, where Juno had put it.
  await sheet.undo(CI_BUILDS).click()
  await expect.poll(() => sheet.status(CI_BUILDS)).toBe('open')
  await sidebar.row(CI_BUILDS).expectAbsent()

  // K keeps it, with the toast's Undo.
  await sheet.row(CI_BUILDS).locator('a').focus()
  await juno.win.keyboard.press('k')
  await juno.expectToast('Keeping #ci-builds in Automated')
  await expect(sheet.outcome(CI_BUILDS)).toHaveText('Kept')
  await sheet.close.click()
  await expect(sheet.root).toHaveCount(0)
  await sidebar.selectView('Automated')
  await sidebar.row(CI_BUILDS).expectVisible()

  // Opened: Home does not list the move again.
  await sidebar.filter('All')
  await sidebar.row(POSTGRES).open()
  await home.open()
  expect(await home.kinds()).not.toContain('automatedMoves')
})
