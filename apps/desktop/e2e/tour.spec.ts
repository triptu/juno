// The tour (SPEC 4): it opens by itself over the app once per workspace,
// when the sidebar has rows: after a first sign-in, once the first sync has
// rows, and on an install from before the tour, on its next launch. It
// moves with the keys, the dots and the app menu's Back and Forward without
// moving anything on screen, Esc skips it, it does not come back after a
// relaunch, and ⌘K, Help and Settings › About open it again.
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { Juno } from './driver/juno'
import { expect, launchApp, test, type RunningApp } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const STEPS = ['Topics, not channels', 'Why a DM can show up twice', 'Getting around', 'Make it yours', 'Juno helps, you decide'] as const

/** Apps that open the tour by itself, as outside tests. */
const opensItself = test.extend({
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
    await use(running)
    await running.close()
  },
})

opensItself('opens once after the first sign-in, when the sidebar has rows, steps without moving, and can be skipped', async ({ juno, running, fake, slackApp, userData }) => {
  const { tour, tabs, sidebar } = juno
  // The first sync has nothing to show yet: no tour over an empty list.
  fake.holdNext({ method: 'client.userBoot', before: true })
  await juno.signIn()
  await sidebar.expectEmpty('Getting your topics')
  await tour.expectClosed()
  fake.release({ method: 'client.userBoot' })
  await sidebar.expectRows()

  await tour.expectOpen()
  await tour.expectStep(STEPS[0])
  await expect(tour.next).toBeFocused()
  await expect(tour.back).toBeDisabled()
  await expect(tour.dot(1)).toHaveAttribute('aria-current', 'step')
  const tabCount = await tabs.root.getByRole('tab').count()
  // The tour opens with the first rows, while the first sync still runs: bot channels leave the list as their
  // history lands and the sync card at the foot goes, which lengthens the list (sidebar.spec.ts checks both).
  // Let the sync end so the check below sees only what the tour does.
  await juno.expectEngineLive()
  await sidebar.expectNoSyncStatus()
  await tour.expectSettled()
  const sheet = await tour.root.boundingBox()

  // Every way of moving, and none of them moves the sheet or anything in it.
  await expectNoLayoutShift(juno.win, async () => {
    await juno.win.keyboard.press('ArrowRight')
    await tour.expectStep(STEPS[1])
    await juno.win.keyboard.press('ArrowLeft')
    await tour.expectStep(STEPS[0])
    await juno.win.keyboard.press('Enter')
    await tour.expectStep(STEPS[1])
    // ⌘] and ⌘[ are the app menu's Forward and Back: they move the tour, not the tab behind it.
    await juno.nav.menu('forward')
    await tour.expectStep(STEPS[2])
    await juno.nav.menu('back')
    await tour.expectStep(STEPS[1])
    await tour.dot(5).click()
    await tour.expectStep(STEPS[4])
  })
  expect(await tour.root.boundingBox()).toEqual(sheet)
  await tabs.expectCount(tabCount)
  // The last step: Next reads Done, and Juno has no provider yet.
  await expect(tour.next).toHaveAccessibleName('Done')
  await expect(tour.root.getByRole('button', { name: 'Add a provider' })).toBeVisible()
  await tour.back.click()
  await tour.expectStep(STEPS[3])

  // Esc skips it.
  await juno.win.keyboard.press('Escape')
  await tour.expectClosed()
  await juno.waitForSync()

  // A relaunch does not bring it back.
  await running.close()
  await expectNoTourAfterLaunch(await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true }))
})

test('an install from before the tour shows it once, on its next launch', async ({ juno, running, fake, slackApp, userData }) => {
  // This app does not open the tour by itself: the workspace never sees it, as on a build from before the tour.
  await juno.signIn()
  await juno.waitForSync()
  await juno.tour.expectClosed()
  await running.close()

  // The update: the first launch opens it over the app once the sidebar has rows.
  const updated = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
  try {
    const after = new Juno(updated.app, updated.win)
    await after.sidebar.expectRows()
    await after.tour.expectOpen()
    await after.tour.expectStep(STEPS[0])
    await after.tour.next.click()
    await after.tour.expectStep(STEPS[1])
    await after.tour.root.getByRole('button', { name: 'Skip tour' }).click()
    await after.tour.expectClosed()
    await after.expectSignedIn('Juno Fake')
  } finally {
    await updated.close()
  }

  // And never again.
  await expectNoTourAfterLaunch(await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true }))
})

test('opens again from ⌘K, Help and Settings › About, and Done closes it', async ({ juno }) => {
  const { tour, palette } = juno
  await juno.signIn()
  await juno.waitForSync()
  await tour.expectClosed()

  // ⌘K: "Show the tour" opens it at the first step, with Next focused.
  await palette.open()
  await palette.type('tour')
  await palette.choose('Show the tour')
  await palette.expectClosed()
  await tour.expectOpen()
  await tour.expectStep(STEPS[0])
  await expect(tour.next).toBeFocused()
  // Next through to the end; Done closes it.
  for (const heading of STEPS.slice(1)) {
    await tour.next.click()
    await tour.expectStep(heading)
  }
  await tour.next.click()
  await tour.expectClosed()

  // Help › Show the Tour.
  await tour.openFromHelp()
  await tour.expectStep(STEPS[0])
  await tour.root.getByRole('button', { name: 'Skip tour' }).click()
  await tour.expectClosed()

  // Settings › About.
  await juno.openSettings('About')
  await juno.settings.root.getByRole('button', { name: 'Show the tour' }).click()
  await tour.expectOpen()
  await tour.expectStep(STEPS[0])
})

/** Launches the app on a workspace that has seen the tour: signed in, synced, and no tour. */
async function expectNoTourAfterLaunch(app: RunningApp): Promise<void> {
  try {
    const juno = new Juno(app.app, app.win)
    await juno.expectSignedIn('Juno Fake')
    await juno.waitForSync()
    await juno.tour.expectClosed()
  } finally {
    await app.close()
  }
}
