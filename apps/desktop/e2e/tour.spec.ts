// The tour (SPEC 4.1): after the first sign-in the tour opens over the
// app, once. It moves with the keys, the dots and the app menu's Back and
// Forward without moving anything on screen, Esc skips it, a relaunch does
// not bring it back, and ⌘K, Help and Settings › About open it again.
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { Juno } from './driver/juno'
import { expect, launchApp, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const STEPS = ['Topics, not channels', 'Why a DM can show up twice', 'Getting around', 'Make it yours', 'Juno helps, you decide'] as const

test('shows once after the first sign-in, steps without moving, and can be skipped', async ({ juno, running, fake, slackApp, userData }) => {
  const { tour, tabs } = juno
  await juno.signIn({ skipSetUp: false })
  await juno.skipSetUp()

  await tour.expectOpen()
  await tour.expectStep(STEPS[0])
  await expect(tour.next).toBeFocused()
  await expect(tour.back).toBeDisabled()
  await expect(tour.dot(1)).toHaveAttribute('aria-current', 'step')
  const tabCount = await tabs.root.getByRole('tab').count()
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

  // Esc skips; focus goes back to the window.
  await juno.win.keyboard.press('Escape')
  await tour.expectClosed()
  await juno.waitForSync()

  // A relaunch does not bring it back.
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const relaunched = new Juno(again.app, again.win)
    await relaunched.expectSignedIn('Juno Fake')
    await relaunched.waitForSync()
    await relaunched.tour.expectClosed()
  } finally {
    await again.close()
  }
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
