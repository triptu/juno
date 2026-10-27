// Plan flow 14: move between two Macs through Settings, then review the restored chat. The same
// move with a crash during the restore is in `e2e/juno-agent/backup.spec.ts`, in Electron.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { answer } from '../../e2e/juno-agent/model'
import { agentReady, card, openChat, openSettings } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const model = () => startFakeOpenRouter({ answer: (request) => {
  if (request.toolResult !== undefined) return '<say>The draft is ready.</say>'
  if (request.input.includes('draft an update')) return { toolCall: { name: 'send_message', arguments: { messages: [{ topic: 'm:C0ENG', text: 'The launch is on Tuesday.' }] } } }
  return answer(request)
} })

/** The first Mac starts synced; another Mac (`otherApp`) signs in first. */
async function ready(juno: Juno, signIn = false): Promise<void> {
  if (signIn) await juno.signIn()
  await juno.waitForSync()
  await agentReady(juno)
}

/** The OS folder picker is a boundary fake: the next pick answers `folder`. */
const pickFolder = (juno: Juno, folder: string) => juno.surface.system('pickFolder', folder)

domTest('a move restores the chat and pending cards for review', async ({ juno, fake, otherApp }) => {
  const shared = await mkdtemp(join(tmpdir(), 'juno-move-'))
  try {
    await ready(juno)
    const chat = await openChat(juno)
    await chat.send('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    await chat.send('draft an update')
    await chat.expectJuno('The draft is ready.')
    await expect(card(chat, 'sendMessage')).toHaveAttribute('data-card-status', 'open')
    const settings = await openSettings(juno, 'Backup & This Mac')
    await pickFolder(juno, shared)
    await settings.getByRole('button', { name: 'Choose folder' }).click()
    await expect(settings.locator('[data-backup-folder]')).toHaveAttribute('title', shared)
    await settings.getByRole('button', { name: 'Export recovery phrase' }).click()
    const phraseSheet = juno.win.getByRole('dialog', { name: 'Your recovery phrase' })
    await expect(phraseSheet).toBeVisible()
    const phrase = phraseSheet.locator('[data-recovery-phrase] > span').allTextContents().join('-')
    expect(phrase).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    await phraseSheet.getByRole('button', { name: 'Done' }).click()
    await settings.getByRole('button', { name: 'Move', exact: true }).click()
    await juno.win.getByRole('dialog', { name: 'Move to another Mac' }).getByRole('button', { name: 'Move', exact: true }).click()
    await expect(settings.locator('[data-owner-line]')).toHaveText(/^Move code /, { timeout: 30_000 })
    const code = /Move code ([A-Z0-9-]+)\./.exec(await settings.locator('[data-owner-line]').textContent())?.[1]
    if (code === undefined) throw new Error('No move code')
    await openChat(juno)
    await expect(chat.root.locator('[data-banner="otherDevice"]')).toBeVisible()
    await expect(chat.composer).toBeDisabled()

    const mac = await otherApp()
    await ready(mac, true)
    const page = await openSettings(mac, 'Backup & This Mac')
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    const restore = mac.win.getByRole('dialog', { name: 'Restore from backup' })
    await pickFolder(mac, shared)
    await restore.getByRole('button', { name: 'Choose folder' }).click()
    await restore.getByLabel('Recovery phrase').fill(phrase)
    await restore.getByLabel('The old Mac is off, erased, or has Juno removed').check()
    await restore.getByRole('button', { name: 'Restore', exact: true }).click()
    await mac.tabs.expectActive('Review')
    const restored = await openChat(mac)
    await restored.expectJuno('You said: what is on today?')
    await expect(restored.ownerBubble('what is on today?')).toHaveCount(1)
    const chip = restored.root.locator('[data-banner="recovery"]')
    await expect(chip).toBeVisible()
    await expect(card(restored, 'sendMessage')).toHaveAttribute('data-card-status', 'open')
    await expect(card(restored, 'sendMessage')).toContainText('This may already have happened.')
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)
    await restored.send('and tomorrow?')
    await expect(restored.ownerBubble('and tomorrow?').locator('[data-delivery="waiting"]')).toBeVisible()
    await chip.getByRole('button', { name: 'Review' }).click()
    await expect(page.locator('[data-move-code]')).toHaveAttribute('data-move-code', code, { timeout: 30_000 })
    await mac.win.locator('main').getByRole('button', { name: 'Activate Juno' }).click()
    await openChat(mac)
    await expect(chip).toHaveCount(0)
    await restored.expectJuno('and tomorrow?')
    await expect(restored.ownerBubble('and tomorrow?')).toHaveCount(1)
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)
  } finally {
    await rm(shared, { recursive: true, force: true })
  }
}, { model, engine: { backupIntervalMs: 1_000 } })
