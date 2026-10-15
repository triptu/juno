// Plan flow 14 (M7 Ownership, SPEC 13.8): a cooperative move between two agent directories, and a
// restore into recovery mode. Two launches on two user-data directories play two Macs that share
// one backup folder.
//
// Skipped: the backup and ownership services exist in `packages/agent/src/{backup,ownership}`, but
// the app does not wire them yet. `apps/desktop/src/agent/index.ts` passes no `backup` to
// `startAgent`, Settings › Juno is rendered without `onMove`, `onRestore` or `onBackupFolder`
// (`apps/desktop/src/renderer/containers/juno/JunoPages.tsx`), and the Review page's Activate
// does nothing. The wiring is on the wp21-wire branch. Turn this on when it lands, and set the
// shared backup folder through whatever launch option that branch adds.
import { rm } from 'node:fs/promises'
import { Juno } from '../driver/juno'
import { launchApp, tempUserData } from '../fixtures'
import { openChat, openPage, ready } from './agent'
import { expect, test } from './chat'

test.describe.configure({ timeout: 180_000 })

test.skip('a move hands Juno to a second Mac, which opens in recovery until the owner reviews and activates it', async ({ juno, fake, slackApp, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')

  // The first Mac: Move finishes what is running, turns read-only and shows a move code.
  const settings = await openPage(juno, 'Settings › Juno')
  await settings.getByRole('button', { name: 'Move to another Mac' }).click()
  const code = (await settings.locator('[data-move-code]').textContent())?.trim()
  expect(code).toMatch(/\S/)
  await openChat(juno)
  await expect(juno.win.locator('main').getByText('Juno is working on your other Mac.')).toBeVisible()

  // The second Mac restores from the shared folder and shows the code of the backup it found.
  const other = await tempUserData()
  const second = await launchApp(other, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
  try {
    const mac = new Juno(second.app, second.win)
    await ready(mac)
    const page = await openPage(mac, 'Settings › Juno')
    await page.getByRole('button', { name: 'Restore from backup' }).click()
    await expect(page.locator('[data-move-code]')).toHaveText(code!)
    await page.getByRole('button', { name: 'Restore' }).click()

    // Recovery: the chip offers Review, sends wait, and Activate Juno takes over.
    const restored = await openChat(mac)
    await restored.expectJuno('You said: what is on today?')
    const chip = mac.win.locator('main [data-banner="recovery"]')
    await expect(chip).toHaveText(/Juno restored from backup/)
    await chip.getByRole('button', { name: 'Review' }).click()
    await mac.win.locator('main').getByRole('button', { name: 'Activate Juno' }).click()
    await openChat(mac)
    await expect(chip).toHaveCount(0)
    await restored.send('and tomorrow?')
    await restored.expectJuno('You said: and tomorrow?')
  } finally {
    await second.close()
    await rm(other, { recursive: true, force: true })
  }
})
