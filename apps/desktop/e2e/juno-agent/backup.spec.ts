// Backup, the recovery phrase and a restore on a second Mac (SPEC 13.8), as the owner does it: two
// launches of the app play two Macs that share one backup folder, against one fake Slack.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { Juno } from '../driver/juno'
import { hooks, launchApp, tempUserData } from '../fixtures'
import { expect, JunoChatPane, test as base } from './chat'

/** Exports every second instead of every minute, so each Mac sees the other's backup quickly. */
const BACKUP_INTERVAL_MS = 1_000

const test = base.extend<{ readonly shared: string }>({
  // oxlint-disable-next-line no-empty-pattern
  shared: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-shared-backup-'))
    await use(dir)
    await rm(dir, { recursive: true, force: true })
  },
  running: async ({ fake, slackApp, userData, model }, use) => {
    const running = await launchApp(userData, {
      fakeSlackUrl: fake.url,
      slackAppDir: slackApp.dir,
      keychainPassword: slackApp.keychainPassword,
      agent: true,
      fakeOpenRouterUrl: model.origin,
      deviceName: 'Studio',
      backupIntervalMs: BACKUP_INTERVAL_MS,
    })
    await use(running)
    await running.close()
  },
})

test.describe.configure({ timeout: 180_000 })

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await openChat(juno)
}

const openChat = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()

/** Settings › Backup & This Mac, through the Juno menu's Settings. */
async function openSettings(juno: Juno): Promise<void> {
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: 'Settings' }).click()
  await juno.tabs.expectActive('Settings')
  await juno.win.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Backup & This Mac' }).click()
}

/** The native folder picker is out of reach: main picks this folder the next time it is asked. */
function pickFolderNext(app: ElectronApplication, folder: string): Promise<void> {
  return app.evaluate((_electron, path) => {
    ;(globalThis as unknown as { junoTest: { folder: { next: string | null | undefined } } }).junoTest.folder.next = path
  }, folder)
}

const lastBackupAt = async (juno: Juno) => Number((await juno.win.locator('main [data-last-backup]').getAttribute('data-last-backup')) || 0)

test('backup to a shared folder, export the phrase, restore on a second Mac, and the first Mac turns read-only', async ({ juno, fake, slackApp, model, shared }) => {
  // The first Mac: the backup is on from the start, in its own folder.
  await ready(juno)
  await openSettings(juno)
  const studio = juno.win.locator('main')
  await expect(studio.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible()
  await expect(studio.getByRole('heading', { name: 'This Mac', exact: true })).toBeVisible()
  await expect(studio.locator('[data-owner-line]')).toHaveText('This Mac owns Juno’s state.')
  await expect(studio.locator('[data-last-backup]')).toContainText('Last backup', { timeout: 15_000 })
  const before = await lastBackupAt(juno)

  // Choose the shared folder: the first backup there updates "Last backup".
  await pickFolderNext(juno.app, shared)
  await studio.getByRole('button', { name: 'Choose folder' }).click()
  await expect(studio.locator('[data-backup-folder]')).toHaveAttribute('title', shared)
  await expect.poll(() => lastBackupAt(juno)).toBeGreaterThan(before)

  // Export the phrase: the sheet shows it once, and Copy says so.
  await expect(studio.locator('[data-phrase-exported]')).toHaveAttribute('data-phrase-exported', 'no')
  const exportButton = studio.getByRole('button', { name: 'Export recovery phrase' })
  await exportButton.focus()
  await exportButton.press('Enter')
  const sheet = juno.win.getByRole('dialog', { name: 'Your recovery phrase' })
  await expect(sheet).toBeVisible()
  const phrase = (await sheet.locator('[data-recovery-phrase] > span').allTextContents()).join('-')
  expect(phrase).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await sheet.getByRole('button', { name: 'Copy' }).click()
  await expect(sheet.getByRole('button', { name: 'Copied' })).toBeVisible()
  // The sheet holds the keyboard: Tab goes round its two buttons, never to the page under the dim.
  for (const name of ['Done', 'Copied', 'Done']) {
    await juno.win.keyboard.press('Tab')
    await expect(sheet.getByRole('button', { name })).toBeFocused()
  }
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(exportButton).toBeFocused()
  // A sheet opened from the keyboard gives focus back to its button when it closes (a click on macOS focuses no button).
  await studio.getByRole('button', { name: 'Restore', exact: true }).focus()
  await juno.win.keyboard.press('Enter')
  await expect(juno.win.getByRole('dialog', { name: 'Restore from backup' })).toBeVisible()
  await juno.win.keyboard.press('Escape')
  await expect(juno.win.getByRole('dialog', { name: 'Restore from backup' })).toHaveCount(0)
  await expect(studio.getByRole('button', { name: 'Restore', exact: true })).toBeFocused()
  await expect(studio.locator('[data-phrase-exported]')).toHaveAttribute('data-phrase-exported', 'yes')
  // Main hands the phrase over once.
  expect(await juno.win.evaluate(() => (window as unknown as { juno: { agent: { recoveryPhrase: () => Promise<unknown> } } }).juno.agent.recoveryPhrase())).toBeNull()

  // The second Mac: its own profile, the same Slack, the shared folder.
  const laptopData = await tempUserData()
  const second = await launchApp(laptopData, {
    fakeSlackUrl: fake.url,
    slackAppDir: slackApp.dir,
    keychainPassword: slackApp.keychainPassword,
    agent: true,
    fakeOpenRouterUrl: model.origin,
    deviceName: 'Laptop',
    backupIntervalMs: BACKUP_INTERVAL_MS,
  })
  try {
    const laptop = new Juno(second.app, second.win)
    await ready(laptop)
    await openSettings(laptop)
    const page = laptop.win.locator('main')

    // Restore: the folder, the phrase, and the owner's word that the old Mac is off.
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    const restore = laptop.win.getByRole('dialog', { name: 'Restore from backup' })
    await expect(restore.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled()
    await pickFolderNext(second.app, shared)
    await restore.getByRole('button', { name: 'Choose folder' }).click()
    await expect(restore.locator('[data-restore-folder]')).toHaveText(shared)
    await restore.getByLabel('Recovery phrase').fill(phrase.toLowerCase())
    await restore.getByLabel('The old Mac is off, erased, or has Juno removed').check()
    await restore.getByRole('button', { name: 'Restore', exact: true }).click()

    // The agent restarts into recovery, and Review opens: no move code, so the line about older backups shows.
    await laptop.tabs.expectActive('Review')
    await expect(page.getByText(/^Backup from /)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-review-unchecked]')).toBeVisible()
    await expect(page.locator('[data-move-code]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Activate Juno' }).click()

    // The chat is the laptop's now, and it works.
    const chat = JunoChatPane.tab(laptop.win)
    await expect(chat.composer).toBeEnabled()
    await expect(laptop.win.locator('main [data-banner]')).toHaveCount(0)
    await chat.send('are you here now?')
    await chat.expectJuno('You said: are you here now?')

    // The first Mac reads the laptop's backup in the shared folder and stops.
    await openChat(juno)
    await expect(juno.win.locator('main [data-banner="otherDevice"]')).toBeVisible({ timeout: 20_000 })
    await expect(JunoChatPane.tab(juno.win).composer).toBeDisabled()
    await openSettings(juno)
    await expect(studio.locator('[data-owner-line]')).toHaveText('Juno is working on Laptop. This Mac is read-only.')
    await expect(studio.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()
  } finally {
    await second.close()
    await rm(laptopData, { recursive: true, force: true })
  }
})
