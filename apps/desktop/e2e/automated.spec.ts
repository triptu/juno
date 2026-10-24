// The built-in Automated view (SPEC 5 "Automated", 12) against the fake
// Slack and the fake AI: it fills on the first sync and keeps the bot
// channels out of All; Home asks about a channel neither the rules nor Juno
// could place, and says why; Move and Keep in All stick, with Undo; the question's
// menu ignores a noisy channel; a channel taken out by hand is never moved
// back; and a deleted view stays deleted.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })
// Juno's judgement of unclear channels is a background AI job.
test.use({ aiJobs: true, sidebarTrace: true })

const ALERTS_MAIN = '#alerts-prod'
const DEPLOYS_MAIN = '#deploys'
const RELEASES_MAIN = '#releases'
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

test('the view fills on the first sync and says what Juno added; a channel taken out is never moved back, and a deleted view stays deleted', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno

  await test.step('the view fills on the first sync, keeps the bot channels out of All, and its sheet says what Juno added', async () => {
    // An icon pill, with its name as the tooltip.
    const pill = sidebar.viewPill('Automated')
    await expect(pill).toHaveAttribute('data-tooltip', 'Automated')
    await expect(pill).toHaveText('')
    await sidebar.row(POSTGRES).expectVisible()
    await sidebar.row(ALERTS_MAIN).expectAbsent()
    await sidebar.row(DEPLOYS_MAIN).expectAbsent()

    await sidebar.selectView('Automated')
    await sidebar.row(ALERTS_MAIN).expectVisible()
    await sidebar.row(DEPLOYS_MAIN).expectVisible()
    await sidebar.row(POSTGRES).expectAbsent()

    await sidebar.viewMenu('Automated', 'view-edit')
    const alerts = sidebar.viewSheet.getByRole('option').filter({ hasText: 'alerts-prod' })
    await expect(alerts).toHaveAttribute('aria-selected', 'true')
    await expect(alerts).toContainText('Added by Juno')
    await expect(sidebar.viewSheet.getByRole('checkbox', { name: /Keep these out of All/ })).toBeChecked()
    await sidebar.viewSheet.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('a channel taken out of Automated is never moved back, and a deleted view stays deleted', async () => {
    // From All, as the step above left Automated chosen.
    await sidebar.filter('All')
    await sidebar.selectView('Automated')
    await sidebar.row(ALERTS_MAIN).chooseInMenu('view-remove:automated')
    await juno.expectToast('Removed #alerts-prod from Automated')
    await sidebar.filter('All')
    await sidebar.row(ALERTS_MAIN).expectVisible()
    fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0GRAFANA', text: '[FIRING] disk 90% on db-replica-2' })
    await sidebar.row(ALERTS_MAIN).expectPreview('Grafana: [FIRING] disk 90% on db-replica-2')
    await afterAPass(juno)
    await sidebar.row(ALERTS_MAIN).expectVisible()

    await sidebar.viewMenu('Automated', 'view-delete')
    await juno.expectToast('Deleted view · Automated')
    await expect.poll(() => sidebar.viewNames()).toEqual([])
    await sidebar.row(DEPLOYS_MAIN).expectVisible()
    fake.injectMessage({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: 'web@aa11 deployed to prod' })
    await sidebar.row(DEPLOYS_MAIN).expectPreview(/web@aa11 deployed to prod$/)
    await afterAPass(juno)
    expect(await sidebar.viewNames()).toEqual([])
    await sidebar.row(DEPLOYS_MAIN).expectVisible()
  })
})

test('Home asks about an unclear channel; Move puts it in Automated with Undo, and Keep in All is remembered', async ({ juno, fake }) => {
  addReleases(fake)
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar } = juno

  await homeAsks(juno)
  await expect(home.title('automated')).toHaveText('Move #releases?')
  // The reason: Juno's, from the fake AI.
  await expect(home.meta('automated')).toHaveText('To Automated · 4 of 7 messages from apps')

  await home.button('automated', 'Move').click()
  await juno.expectToast('Moved #releases to Automated')
  // The row goes at once: the user answered it.
  await expect(home.item('automated')).toHaveCount(0)
  await sidebar.row(RELEASES_MAIN).expectAbsent()
  await sidebar.selectView('Automated')
  await sidebar.row(RELEASES_MAIN).expectVisible()

  // Undo puts the question back, with its reason.
  await juno.undo()
  await sidebar.row(RELEASES_MAIN).expectAbsent()
  await homeAsks(juno)
  await expect(home.meta('automated')).toHaveText('To Automated · 4 of 7 messages from apps')

  await home.button('automated', 'Keep in All').click()
  await juno.expectToast('Keeping #releases in All')
  // More from the bot moves nothing and asks nothing.
  for (let n = 0; n < 8; n++) fake.injectMessage({ channel: 'C0RELEASES', user: 'U0DEPLOYBOT', text: `web 2.4.${n} tagged` })
  await sidebar.row(RELEASES_MAIN).expectPreview(/web 2\.4\.7 tagged$/)
  await afterAPass(juno)
  await sidebar.row(RELEASES_MAIN).expectVisible()
  await sidebar.row(POSTGRES).open()
  await home.open()
  expect(await home.kinds()).not.toContain('automated')
})

test("the question's menu ignores a noisy channel", async ({ juno, fake }) => {
  addReleases(fake)
  await juno.signIn()
  await juno.waitForSync()
  await homeAsks(juno)

  const labels = await juno.home.chooseInItemMenu('automated', 'ignore-channel')
  expect(labels).toContain('Ignore channel')
  await juno.expectToast('Ignoring #releases')
  await juno.sidebar.row(RELEASES_MAIN).expectAbsent()
})
