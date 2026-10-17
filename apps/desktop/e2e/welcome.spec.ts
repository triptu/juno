// The welcome card (SPEC 4, "The welcome"): three things to try on Home. It
// shows by itself once per workspace when the sidebar has rows: after a first
// sign-in, once the first sync has rows, and on an install from before it,
// on its next launch. Each hint ticks when it is done, anywhere in the app,
// and the ticks survive a relaunch. With all three done it says "You're all
// set"; Done or Hide puts it away for good, and ⌘K, Help and Settings › About
// bring it back. Nothing around it moves when it appears, ticks or goes.
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import type { Locator } from '@playwright/test'
import { Juno } from './driver/juno'
import { expect, launchApp, test, type RunningApp } from './fixtures'

test.describe.configure({ timeout: 150_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

/** Apps that show the card by themselves, as outside tests. */
const showsItself = test.extend({
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
    await use(running)
    await running.close()
  },
})

const boxes = (locators: ReadonlyArray<Locator>) => Promise.all(locators.map((locator) => locator.boundingBox()))

showsItself('shows on Home after the first sign-in once the sidebar has rows, ticks each hint where it is done, keeps the ticks over a relaunch, and Done puts it away', async ({ juno, running, fake, slackApp, userData }) => {
  const { welcome, sidebar, write, tabs } = juno
  // The first sync has nothing to show yet: the card keeps its room, empty.
  fake.holdNext({ method: 'client.userBoot', before: true })
  await juno.signIn()
  await sidebar.expectEmpty('Getting your topics')
  await welcome.expectGone()
  const composer = [write.chip, write.field]
  const before = await boxes(composer)
  fake.release({ method: 'client.userBoot' })
  await sidebar.expectRows()

  await welcome.expectShown()
  await expect(welcome.heading).toHaveText('Three things to try')
  await expect(welcome.close).toHaveText('Hide')
  await welcome.expectTicked()
  await welcome.expectWholeAboveField()
  // The field and its chip stayed where they were when the card filled its room.
  expect(await boxes(composer)).toEqual(before)

  // Peek: hold ⌥ over a row. The tick moves nothing.
  await expectNoLayoutShift(juno.win, async () => {
    await sidebar.row(RINA).peek()
    await juno.peek.expectShowing(RINA)
    await juno.peek.release()
    await juno.peek.expectClosed()
    await welcome.expectTicked('peek')
  })

  // A topic in a new tab, by ⌘-click on its row.
  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectCount(2)
  await tabs.select('Home')
  await welcome.expectTicked('peek', 'tab')

  // The ticks survive a relaunch.
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
  try {
    const after = new Juno(again.app, again.win)
    await after.sidebar.expectRows()
    await after.tabs.select('Home')
    await after.welcome.expectShown()
    await after.welcome.expectTicked('peek', 'tab')

    // A question to Juno from Home's field. It opens the Juno chat; Back returns to Home.
    await after.write.write('What did I miss today?')
    await after.write.send()
    await after.nav.menu('back')
    await after.home.expectShown()
    await after.welcome.expectTicked('peek', 'tab', 'juno')
    await expect(after.welcome.heading).toHaveText('You’re all set')
    await expect(after.welcome.close).toHaveText('Done')

    // Done: the card goes, and its room stays for this visit, so nothing moves.
    await expectNoLayoutShift(after.win, async () => {
      await after.welcome.close.click()
      await after.welcome.expectGone()
    })
  } finally {
    await again.close()
  }

  // Never again by itself.
  await expectNoCardAfterLaunch(await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true }))
})

test('an install from before the welcome card shows it once, on its next launch', async ({ juno, running, fake, slackApp, userData }) => {
  // This app does not show the card by itself: the workspace never sees it, as on a build from before it.
  await juno.signIn()
  await juno.waitForSync()
  await juno.welcome.expectGone()
  await running.close()

  const updated = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true })
  try {
    const after = new Juno(updated.app, updated.win)
    await after.sidebar.expectRows()
    await after.welcome.expectShown()
    await after.welcome.close.click()
    await after.welcome.expectGone()
  } finally {
    await updated.close()
  }

  await expectNoCardAfterLaunch(await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, tour: true }))
})

test('Hide puts it away without moving Home, and ⌘K, Help and Settings › About bring it back on Home', async ({ juno }) => {
  const { welcome, palette, home } = juno
  await juno.signIn()
  await juno.waitForSync()
  await welcome.expectGone()

  // ⌘K: "Show the tour" brings the card back on Home, nothing ticked.
  await juno.sidebar.row(POSTGRES).open()
  await palette.open()
  await palette.type('tour')
  await palette.choose('Show the tour')
  await palette.expectClosed()
  await home.expectShown()
  await welcome.expectShown()
  await welcome.expectTicked()
  await welcome.expectWholeAboveField()

  // Hide: the card goes; its room stays for this visit, so the rows and the field stay put.
  await expectNoLayoutShift(juno.win, async () => {
    await welcome.close.click()
    await welcome.expectGone()
  })

  // Help › Show the Tour.
  await welcome.openFromHelp()
  await home.expectShown()
  await welcome.close.click()
  await welcome.expectGone()

  // Settings › About.
  await juno.openSettings('About')
  await juno.settings.root.getByRole('button', { name: 'Show the tour' }).click()
  await home.expectShown()
  await welcome.expectShown()
})

/** Launches the app on a workspace that has seen the card: signed in, synced, and no card on Home. */
async function expectNoCardAfterLaunch(app: RunningApp): Promise<void> {
  try {
    const juno = new Juno(app.app, app.win)
    await juno.expectSignedIn('Juno Fake')
    await juno.waitForSync()
    await juno.home.expectShown()
    await juno.welcome.expectGone()
  } finally {
    await app.close()
  }
}
