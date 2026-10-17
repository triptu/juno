// Automated's record (SPEC 5 "Automated", 12 "Automated's record") against
// the fake Slack: a bot channel joined after the first sync moves by itself
// and Home's card explains it with the counts that decided; Move back puts it
// in All and Undo gives it back to Automated; a channel where people start
// the conversations stays in All however much a bot replies in its threads;
// and a channel people take over goes back out, which the card says, with
// Dismiss to see it without opening the record.
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const CI_BUILDS = '#ci-builds'
const ALERTS = '#alerts-prod'
const AGENTS = '#eng-agents'
const POSTGRES = 'Draft plan is in the doc'

/** Home reads its items when it appears, and shows the record once: show a topic, then Home, until the card is there. */
async function homeShowsRecord(juno: Juno): Promise<void> {
  await expect
    .poll(
      async () => {
        await juno.sidebar.filter('All')
        await juno.sidebar.row(POSTGRES).open()
        await juno.home.open()
        return juno.home.kinds()
      },
      { timeout: 30_000 },
    )
    .toContain('automatedMoves')
}

/** The job takes changes in 3 second windows; after this a pass has looked at them. */
const afterAPass = (juno: Juno) => juno.win.waitForTimeout(4_000)

test('a bot channel joined later moves by itself, the card says why, and Move back works with Undo', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

  const sheet = await home.reviewOf('automatedMoves', 'automated')
  await expect(sheet.title).toHaveText('Juno moved 1 channel to Automated')
  await expect(sheet.reason(CI_BUILDS)).toHaveText('Apps wrote 6 of the last 6 top-level messages')
  await sheet.about.click()
  await expect(sheet.explainer).toContainText('Nothing changes in Slack.')
  // The info covers the top of the list; the button closes it again.
  await sheet.about.click()

  await sheet.act(CI_BUILDS).click()
  await juno.expectToast('Moved #ci-builds back to All')
  await expect(sheet.outcome(CI_BUILDS)).toHaveText('Moved back to All')
  await sidebar.row(CI_BUILDS).expectVisible()

  // Undo on the row gives the channel back to Automated, where Juno had put it.
  await sheet.undo(CI_BUILDS).click()
  await expect.poll(() => sheet.status(CI_BUILDS)).toBe('open')
  await sidebar.row(CI_BUILDS).expectAbsent()

  // K keeps it, with the toast's Undo.
  await sheet.row(CI_BUILDS).locator('a').focus()
  await juno.win.keyboard.press('k')
  await juno.expectToast('Keeping #ci-builds in Automated')
  await expect(sheet.outcome(CI_BUILDS)).toHaveText('Kept in Automated')
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

test('a channel where people start the conversations stays in All, however much a bot replies in its threads', async ({ juno, fake }) => {
  // People ask the coding bot in top-level posts; it answers in each thread, many times.
  fake.addChannel({
    id: 'C0ENGAGENTS',
    name: 'eng-agents',
    messages: ['U0SAM', 'U0PRIYA', 'U0SAM', 'U0DEV', 'U0PRIYA', 'U0SAM'].map((user, n) => ({
      user,
      text: `<@U0DEPLOYBOT> please look at the flaky test in suite ${n + 1}`,
      ago: 120 - n * 15,
      replies: Array.from({ length: 5 }, (_, r) => ({ user: 'U0DEPLOYBOT', text: `Step ${r + 1}: reran suite ${n + 1}`, ago: 118 - n * 15 - r })),
    })),
  })
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno

  await sidebar.row(AGENTS).expectVisible()
  fake.injectMessage({ channel: 'C0ENGAGENTS', user: 'U0PRIYA', text: 'Thanks, the suite is green now' })
  await sidebar.row(AGENTS).expectPreview(/the suite is green now$/)
  await afterAPass(juno)
  await sidebar.row(AGENTS).expectVisible()
  await sidebar.selectView('Automated')
  await sidebar.row(AGENTS).expectAbsent()
})

test('a channel people take over goes back to All, and the card says people start most conversations there', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar } = juno
  await sidebar.row(ALERTS).expectAbsent()

  // Its name says alerts, so people must start seven in ten of its latest 30 top-level messages.
  for (let n = 0; n < 21; n++) fake.injectMessage({ channel: 'C0ALERTSPROD', user: n % 2 === 0 ? 'U0SAM' : 'U0PRIYA', text: `Looking into the p95 spike, note ${n + 1}` })
  await sidebar.row(ALERTS).expectVisible()

  await homeShowsRecord(juno)
  await expect(home.title('automatedMoves')).toHaveText('Juno moved 1 channel out of Automated')
  // Dismiss sees the moves without opening the record; the row stays while Home is on screen, without its button.
  await home.button('automatedMoves', 'Dismiss').click()
  await expect(home.button('automatedMoves', 'Dismiss')).toHaveCount(0)
  const sheet = await home.reviewOf('automatedMoves', 'automated')
  await expect(sheet.reason(ALERTS)).toHaveText('Moved back: people start most conversations here')
  await expect(sheet.row(ALERTS)).toContainText('People wrote 21 of the last 30 top-level messages')
})
