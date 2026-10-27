// The built-in Automated view (SPEC 5 "Automated", 12) against the fake
// Slack and the fake AI: Home asks about a channel neither the rules nor Juno
// could place; Move and Keep in All stick, with Undo; the question's menu
// ignores a noisy channel. Automated's record (SPEC 12 "Automated's record"):
// a bot channel joined after the first sync moves by itself, Home's card says
// so, and Move back and Undo work in its sheet. Which channels move, and the
// reasons and counts shown, are the engine's sidebar flow test.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const RELEASES_MAIN = '#releases'
const CI_BUILDS = '#ci-builds'
const POSTGRES = 'Draft plan is in the doc'

/** More top-level posts from the deploy bot than from people, but not nearly all: the rules cannot tell, and the fake AI is not sure either. */
function addReleases(fake: FakeSlack): void {
  fake.addChannel({
    id: 'C0RELEASES',
    name: 'releases',
    messages: [
      { user: 'U0DEPLOYBOT', text: 'web 2.3.0 tagged', ago: 60 },
      { user: 'U0SAM', text: 'Release notes for 2.3 are in the doc.', ago: 55 },
      { user: 'U0DEPLOYBOT', text: 'api 1.9.0 tagged', ago: 50 },
      { user: 'U0PRIYA', text: 'Can we hold 2.3 until the icons land?', ago: 45 },
      { user: 'U0DEPLOYBOT', text: 'web 2.3.1 tagged', ago: 40 },
      { user: 'U0SAM', text: 'Sure, Friday then.', ago: 35 },
      { user: 'U0DEPLOYBOT', text: 'web 2.3.2 tagged', ago: 30 },
    ],
  })
}

/** Home reads its items when it appears: show a topic, then Home again, until Automated's question is there. */
async function homeAsks(juno: Juno): Promise<void> {
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
    .toContain('automated')
}

/** The job has examined the changed rows, including a pass that keeps their placement. */
const afterAPass = (juno: Juno) => juno.workPass('automated')

// The view's first fill, a channel taken out by hand and a deleted view are the engine's sidebar flow test.
domTest('Home asks about an unclear channel and Move, Ignore and Keep in All stick; a bot channel joined later moves by itself and Move back works', async ({ juno, fake, step }) => {
  addReleases(fake)
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar } = juno
  // The first sync's own sorting is setting up, not news.
  await home.open()
  expect(await home.kinds()).not.toContain('automatedMoves')

  await step('Move puts the channel in Automated, and Undo puts the question back', async () => {
    await homeAsks(juno)
    await home.button('automated', 'Move').click()
    await juno.expectToast('Moved #releases to Automated')
    // The row goes at once: the user answered it.
    await expect(home.item('automated')).toHaveCount(0)
    await sidebar.row(RELEASES_MAIN).expectAbsent()
    await sidebar.selectView('Automated')
    await sidebar.row(RELEASES_MAIN).expectVisible()

    await juno.undo()
    await sidebar.row(RELEASES_MAIN).expectAbsent()
    await homeAsks(juno)
  })

  await step('the question\'s menu ignores the channel, and Undo brings it back', async () => {
    await home.chooseInItemMenu('automated', 'ignore-channel')
    await juno.expectToast('Ignoring #releases')
    await sidebar.row(RELEASES_MAIN).expectAbsent()
    await juno.undo()
    await sidebar.row(RELEASES_MAIN).expectVisible()
    await homeAsks(juno)
  })

  await step('Keep in All is remembered: more from the bot moves nothing and asks nothing', async () => {
    await home.button('automated', 'Keep in All').click()
    await juno.expectToast('Keeping #releases in All')
    for (let n = 0; n < 8; n++) fake.injectMessage({ channel: 'C0RELEASES', user: 'U0DEPLOYBOT', text: `web 2.4.${n} tagged` })
    await sidebar.row(RELEASES_MAIN).expectPreview(/web 2\.4\.7 tagged$/)
    await afterAPass(juno)
    await sidebar.row(RELEASES_MAIN).expectVisible()
    await sidebar.row(POSTGRES).open()
    await home.open()
    expect(await home.kinds()).not.toContain('automated')
  })

  await step('a bot channel joined later moves by itself, Home\'s card names it, and Move back and Undo work in the sheet', async () => {
    fake.workspace.addConversation({ id: 'C0CIBUILDS', name: 'ci-builds', kind: 'public', members: new Set(['U0DEPLOYBOT']), created: fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
    fake.joinChannel({ channel: 'C0CIBUILDS' })
    for (let n = 1; n <= 6; n++) fake.injectMessage({ channel: 'C0CIBUILDS', user: 'U0DEPLOYBOT', text: `main #${n} passed` })

    // Home is live; stay on it so a card shown once is not lost by opening another visit.
    await home.open()
    await expect.poll(() => home.kinds(), { timeout: 30_000 }).toContain('automatedMoves')
    await expect(home.meta('automatedMoves')).toContainText('ci-builds')
    // Home's card can come before the sidebar's list says the channel left, and opening a row to read Home afresh held
    // the list: wait until the sidebar shows the move, so the sheet's hold starts from it.
    await sidebar.row(CI_BUILDS).expectAbsent()

    const sheet = await home.reviewOf('automatedMoves', 'automated')
    await sheet.act(CI_BUILDS).click()
    await expect.poll(() => sheet.status(CI_BUILDS)).toBe('done')
    // The sidebar holds behind the sheet (SPEC 5): the channel comes to All when the sheet closes.
    await sidebar.row(CI_BUILDS).expectAbsent()

    // Undo on the row gives the channel back to Automated, where Juno had put it; K keeps it there.
    await sheet.undo(CI_BUILDS).click()
    await expect.poll(() => sheet.status(CI_BUILDS)).toBe('open')
    await sheet.row(CI_BUILDS).locator('a').focus()
    await juno.win.keyboard.press('k')
    await expect.poll(() => sheet.status(CI_BUILDS)).toBe('declined')
    await sheet.close.click()
    await expect(sheet.root).toHaveCount(0)
    await sidebar.selectView('Automated')
    await sidebar.row(CI_BUILDS).expectVisible()

    // Opened: a later Home does not list the move again. This Home keeps it until it leaves, so wait for the topic.
    await sidebar.filter('All')
    await sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await home.open()
    expect(await home.kinds()).not.toContain('automatedMoves')
  })
}, { synced: false, engine: { aiJobs: true } })
