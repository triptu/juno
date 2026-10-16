/**
 * Privacy mode turns on by itself while the screen is shared (SPEC section 5,
 * docs/research/screen-share-detection.md). Main's screen watch is replaced
 * by a seam under JUNO_E2E, so the test says when sharing starts and stops.
 */
import { expect, test } from './fixtures'

const RINA = 'Rina finished the onsite.'
const SWITCH = 'Hide message text while sharing the screen'

test('sharing the screen hides message text and says why, and stopping shows it again', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, privacy } = juno
  const rina = sidebar.row(RINA)
  await rina.expectVisible()

  await privacy.startSharing()
  await privacy.expectBlurred(rina.preview)
  await expect(privacy.footer).toBeVisible()
  expect(await privacy.footerText()).toBe('Message text hidden while sharing')
  expect(await privacy.menuLabel()).toBe('Show Message Text')

  await privacy.stopSharing()
  await expect(privacy.footer).toHaveCount(0)
  await privacy.expectBlurred(rina.preview, false)
  expect(await privacy.menuLabel()).toBe('Hide Message Text')

  // Show turns it off for this share; the next share hides the text again.
  await privacy.startSharing()
  await expect(privacy.footer).toBeVisible()
  await privacy.showButton.click()
  await expect(privacy.footer).toHaveCount(0)
  await expect.poll(() => privacy.menuLabel()).toBe('Hide Message Text')
  await privacy.startSharing()
  await privacy.expectBlurred(rina.preview, false)
  await privacy.stopSharing()
  await privacy.startSharing()
  await expect(privacy.footer).toBeVisible()
  await privacy.stopSharing()
  await expect(privacy.footer).toHaveCount(0)
})

test('a mode turned on by hand stays on after sharing stops, and the setting turns hiding off', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, privacy } = juno
  const rina = sidebar.row(RINA)
  await rina.expectVisible()

  await privacy.toggleWithMenu()
  await expect(privacy.footer).toBeVisible()
  await privacy.startSharing()
  await privacy.stopSharing()
  await expect(privacy.footer).toBeVisible()
  expect(await privacy.footerText()).toBe('Message text hidden')
  await privacy.expectBlurred(rina.preview)

  // Turned on by sharing, then touched by hand (off and on again): it is the user's now and stays on.
  await privacy.toggleWithMenu()
  await expect(privacy.footer).toHaveCount(0)
  await privacy.startSharing()
  await expect(privacy.footer).toBeVisible()
  await privacy.toggleWithMenu()
  await privacy.toggleWithMenu()
  await privacy.stopSharing()
  await expect(privacy.footer).toBeVisible()
  expect(await privacy.footerText()).toBe('Message text hidden')
  await privacy.toggleWithMenu()
  await expect(privacy.footer).toHaveCount(0)

  // Off in Settings › General: sharing leaves the text alone.
  await juno.openSettings('General')
  const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect(toggle).not.toBeChecked()
  await privacy.startSharing()
  await privacy.stopSharing()
  await expect(privacy.footer).toHaveCount(0)
  await juno.openSettings('General')
  await expect(toggle).not.toBeChecked()
})
