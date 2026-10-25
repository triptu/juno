// The welcome card (SPEC 4, "The welcome"): on an install from before it, it shows once, on the
// next launch; Hide puts it away for good, and ⌘K, Help and Settings › About bring it back with
// nothing ticked. The first sign-in, the ticks and that nothing moves are the browser lane's
// (welcome.spec.ts).
import type { Juno } from './driver/juno'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

/** A launch on a workspace that has seen the card: synced, and no card on Home. */
async function expectNoCardAfterLaunch(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await juno.home.expectShown()
  await juno.welcome.expectGone()
}

domTest('an install from before the welcome card shows it once, on its next launch; Hide puts it away, and ⌘K, Help and Settings › About bring it back', async ({ juno, relaunch }) => {
  // The snapshot's app did not show the card by itself: the workspace never saw it, as on a build from before it.
  await juno.welcome.expectGone()

  const after = await relaunch({ tour: true })
  await after.sidebar.expectRows()
  await after.welcome.expectShown()
  await after.welcome.close.click()
  await after.welcome.expectGone()

  // Put away for good, the card comes back only when asked for. Nothing was done, so nothing is ticked.
  const last = await relaunch({ tour: true })
  await expectNoCardAfterLaunch(last)
  const { welcome, palette, home } = last

  // ⌘K: "Show the tour" brings the card back on Home, nothing ticked.
  await last.sidebar.row(POSTGRES).open()
  await palette.open()
  await palette.type('tour')
  await palette.choose('Show the tour')
  await palette.expectClosed()
  await home.expectShown()
  await welcome.expectShown()
  await welcome.expectTicked()
  await welcome.close.click()
  await welcome.expectGone()

  // Help › Show the Tour.
  await welcome.openFromHelp()
  await home.expectShown()
  await welcome.close.click()
  await welcome.expectGone()

  // Settings › About.
  await last.openSettings('About')
  await last.settings.root.getByRole('button', { name: 'Show the tour' }).click()
  await home.expectShown()
  await welcome.expectShown()
})
