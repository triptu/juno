import type { Fixtures } from './fixtures'
/**
 * Privacy mode turns on by itself when a share starts while Juno runs (SPEC
 * section 5, docs/research/screen-share-detection.md). Main's screen watch is
 * replaced by a seam under JUNO_E2E, so the test says when the screen is
 * captured. The first reading is a baseline: a capture already running at
 * launch hides nothing.
 */
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const SWITCH = 'Hide message text while sharing the screen'
const ALWAYS_ON = "Another app is recording the screen all the time, so Juno can't tell when you share. Use ⌃⌘H to hide message text."

test('hides text while sharing and respects manual privacy and the setting', async ({ juno }) => {
  const context = { juno }
  await test.step('a share that starts while Juno runs hides message text and says why, and stopping shows it again', () => sharePrivacy(context))
  await test.step('a mode turned on by hand stays on after sharing stops, and the setting turns hiding off', () => manualPrivacy(context))
})

async function sharePrivacy({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
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
}

async function manualPrivacy({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
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
}

test('a capture running at launch hides nothing; one that never stops says detection is not available, until it stops and the next share hides the text', async ({ juno, running, userData, fake, slackApp }) => {
  // Sharing turned the mode on when Juno quit; the next launch has it as the user left it, off.
  await juno.privacy.startSharing()
  await expect(juno.privacy.footer).toBeVisible()
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, screenShared: true })
  try {
    const second = new Juno(again.app, again.win)
    // The relaunched app starts its engine and catches up before the rows show.
    await second.waitForSync()
    const rina = second.sidebar.row(RINA)
    await rina.expectVisible()
    await second.privacy.startSharing()
    await expect(second.privacy.footer).toHaveCount(0)
    await second.privacy.expectBlurred(rina.preview, false)
    expect(await second.privacy.menuLabel()).toBe('Hide Message Text')

    await second.openSettings('General')
    await expect(second.settings.root.getByText(ALWAYS_ON)).toHaveCount(0)
    // True since launch for more than two minutes.
    await second.privacy.elapse(2 * 60_000 + 1_000)
    await second.settings.show('Appearance')
    await second.settings.show('General')
    await expect(second.settings.root.getByText(ALWAYS_ON)).toBeVisible()
    await expect(second.settings.root.getByRole('switch', { name: SWITCH })).toBeChecked()
    await expect(second.privacy.footer).toHaveCount(0)

    // The capture stops: detection is available again, and the next share hides the text.
    await second.privacy.stopSharing()
    await second.settings.show('Appearance')
    await second.settings.show('General')
    await expect(second.settings.root.getByText(ALWAYS_ON)).toHaveCount(0)
    await second.privacy.startSharing()
    await expect(second.privacy.footer).toBeVisible()
    await second.privacy.expectBlurred(rina.preview)
    expect(await second.privacy.footerText()).toBe('Message text hidden while sharing')
  } finally {
    await again.close()
  }
})
