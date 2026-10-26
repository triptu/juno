// Backup, the recovery phrase and a move to a second Mac (SPEC 13.8; plan flow 14), as the owner does it: two
// launches of the app play two Macs that share one backup folder, against one fake Slack. Electron has the
// native folder picker and keychain, and restarts the new Mac's agent when it is killed as the restored
// database is swapped in. The same flows with no crash, and the phrase sheet's keyboard, are in the DOM lane
// (`dom/juno-agent/backup.test.ts`, `dom/juno-agent/transfer.test.ts`).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from '../driver/juno'
import { agentReady, card, expectArmedCrash, openChat, openSettings, pickFolder, ready, restartArmed } from './agent'
import { answer, expect, test as base } from './chat'

/** Exports every second instead of every minute, so each Mac sees the other's backup quickly. */
const BACKUP_INTERVAL_MS = 1_000

const test = base.extend<{ readonly shared: string; readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      if (request.toolResult !== undefined) return '<say>The draft is ready.</say>'
      if (request.input.includes('draft an update')) return { toolCall: { name: 'send_message', arguments: { messages: [{ topic: 'm:C0ENG', text: 'The launch is on Tuesday.' }] } } }
      return answer(request)
    } })
    try { await use(model) } finally { await model.close() }
  },
  // Start before either app so both close before this folder is removed.
  // oxlint-disable-next-line no-empty-pattern
  shared: [async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-shared-backup-'))
    try { await use(dir) } finally { await rm(dir, { recursive: true, force: true }) }
  }, { auto: true }],
  agentOptions: async ({ model }, use) => use({ agent: true, fakeOpenRouterUrl: model.origin, deviceName: 'Studio', backupIntervalMs: BACKUP_INTERVAL_MS }),
})

test.describe.configure({ timeout: 180_000 })

const point = 'restore.swapped'

const lastBackupAt = async (juno: Juno) => Number((await juno.win.locator('main [data-last-backup]').getAttribute('data-last-backup')) || 0)

test(`backup to a shared folder, export the phrase, move to a second Mac whose agent dies at ${point}, review the restored chat and pending card, and the first Mac turns read-only`, { tag: ['@nightly', '@nightly-crash'] }, async ({ juno, fake, otherApp, shared }) => {
  const { phrase, code } = await test.step('the first Mac backs up to the shared folder, exports the phrase and moves', () => backUpAndMove(juno, shared))
  const laptop = await otherApp({ deviceName: 'Laptop', backupIntervalMs: BACKUP_INTERVAL_MS })
  await test.step(`the second Mac restores, its agent dies at ${point}, and the chat and card come back for review`, () => restoreWithCrash(laptop, fake, shared, phrase, code))
  await test.step('the first Mac reads the laptop\'s backup in the shared folder: the owner line names the laptop', async () => {
    const studio = await openSettings(juno, 'Backup & This Mac')
    await expect(studio.locator('[data-owner-line]')).toContainText('Laptop', { timeout: 20_000 })
    await expect(studio.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()
  })
})

/** The first Mac: a chat with a pending card, and the backup on from the start, in its own folder. */
async function backUpAndMove(juno: Juno, shared: string): Promise<{ readonly phrase: string; readonly code: string }> {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  await chat.send('draft an update')
  await chat.expectJuno('The draft is ready.')
  await expect(card(chat, 'sendMessage')).toHaveAttribute('data-card-status', 'open')

  const studio = await openSettings(juno, 'Backup & This Mac')
  // This Mac owns Juno's state, and a first backup has been made.
  await expect(studio.locator('[data-owner-line]')).not.toContainText('read-only')
  await expect.poll(() => lastBackupAt(juno), { timeout: 15_000 }).toBeGreaterThan(0)
  const before = await lastBackupAt(juno)

  // Choose the shared folder: the first backup there updates "Last backup".
  await pickFolder(juno, shared)
  await studio.getByRole('button', { name: 'Choose folder' }).click()
  await expect(studio.locator('[data-backup-folder]')).toHaveAttribute('title', shared)
  await expect.poll(() => lastBackupAt(juno)).toBeGreaterThan(before)

  // Export the phrase: the sheet shows it once.
  await studio.getByRole('button', { name: 'Export recovery phrase' }).click()
  const sheet = juno.win.getByRole('dialog', { name: 'Your recovery phrase' })
  await expect(sheet).toBeVisible()
  const phrase = (await sheet.locator('[data-recovery-phrase] > span').allTextContents()).join('-')
  expect(phrase).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(studio.locator('[data-phrase-exported]')).toHaveAttribute('data-phrase-exported', 'yes')
  // Main hands the phrase over once.
  expect(await juno.win.evaluate(() => (window as unknown as { juno: { agent: { recoveryPhrase: () => Promise<unknown> } } }).juno.agent.recoveryPhrase())).toBeNull()

  // Move: the first Mac stops and shows the code the new Mac's review checks.
  await studio.getByRole('button', { name: 'Move', exact: true }).click()
  await juno.win.getByRole('dialog', { name: 'Move to another Mac' }).getByRole('button', { name: 'Move', exact: true }).click()
  await expect(studio.locator('[data-owner-line]')).toHaveText(/^Move code /, { timeout: 30_000 })
  const code = /Move code ([A-Z0-9-]+)\./.exec(await studio.locator('[data-owner-line]').innerText())?.[1]
  if (code === undefined) throw new Error('No move code')
  await openChat(juno)
  await expect(chat.root.locator('[data-banner="otherDevice"]')).toBeVisible()
  await expect(chat.composer).toBeDisabled()
  return { phrase, code }
}

/** The second Mac: its own profile, the same Slack, the shared folder. */
async function restoreWithCrash(laptop: Juno, fake: FakeSlack, shared: string, phrase: string, code: string): Promise<void> {
  await ready(laptop)
  await restartArmed(laptop.app, point)
  await agentReady(laptop.app)
  const page = await openSettings(laptop, 'Backup & This Mac')
  // Restore: the folder, the phrase (in any case), and the owner's word that the old Mac is off.
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const restore = laptop.win.getByRole('dialog', { name: 'Restore from backup' })
  await expect(restore.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled()
  await pickFolder(laptop, shared)
  await restore.getByRole('button', { name: 'Choose folder' }).click()
  await expect(restore.locator('[data-restore-folder]')).toHaveText(shared)
  await restore.getByLabel('Recovery phrase').fill(phrase.toLowerCase())
  await restore.getByLabel('The old Mac is off, erased, or has Juno removed').check()
  await restore.getByRole('button', { name: 'Restore', exact: true }).click()
  await expectArmedCrash(laptop.app)
  await laptop.win.keyboard.press('Escape')

  // Electron restarted the killed agent on the restored database: the chat and the card are back, for review.
  const restored = await openChat(laptop)
  await restored.expectJuno('You said: what is on today?')
  await expect(restored.ownerBubble('what is on today?')).toHaveCount(1)
  const chip = restored.root.locator('[data-banner="recovery"]')
  await expect(chip).toContainText('Juno restored from backup')
  await expect(card(restored, 'sendMessage')).toHaveAttribute('data-card-status', 'open')
  await expect(card(restored, 'sendMessage')).toContainText('This may already have happened.')
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)
  await restored.send('and tomorrow?')
  await expect(restored.ownerBubble('and tomorrow?').locator('[data-delivery="waiting"]')).toHaveText('Waiting for your review')
  await chip.getByRole('button', { name: 'Review' }).click()
  await expect(page.locator('[data-move-code]')).toHaveAttribute('data-move-code', code, { timeout: 30_000 })
  await laptop.win.locator('main').getByRole('button', { name: 'Activate Juno' }).click()
  await openChat(laptop)
  await expect(chip).toHaveCount(0)
  await restored.expectJuno('and tomorrow?')
  await expect(restored.ownerBubble('and tomorrow?')).toHaveCount(1)
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)
}
