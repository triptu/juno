// Plan flow 14 with a crash: move between two Macs through Settings while the new Mac's agent is
// killed as the restored database is swapped in, then review the restored chat. Electron restarts
// the killed agent. The same move with no crash is in the DOM lane (`dom/juno-agent/transfer.test.ts`).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { agentReady, pickFolder, card, expectArmedCrash, openChat, openSettings, ready, restartArmed } from './agent'
import { answer, expect, test as base } from './chat'

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
    const folder = await mkdtemp(join(tmpdir(), 'juno-move-'))
    try { await use(folder) } finally { await rm(folder, { recursive: true, force: true }) }
  }, { auto: true }],
  agentOptions: async ({ model }, use) => use({ agent: true, fakeOpenRouterUrl: model.origin, backupIntervalMs: 1_000 }),
})

test.describe.configure({ timeout: 180_000 })

const point = 'restore.swapped'

test(`a move restores the chat and pending cards for review after a crash at ${point}`, async ({ juno, fake, otherApp, shared }) => {
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
  const phrase = (await phraseSheet.locator('[data-recovery-phrase] > span').allTextContents()).join('-')
  expect(phrase).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await phraseSheet.getByRole('button', { name: 'Done' }).click()
  await settings.getByRole('button', { name: 'Move', exact: true }).click()
  await juno.win.getByRole('dialog', { name: 'Move to another Mac' }).getByRole('button', { name: 'Move', exact: true }).click()
  await expect(settings.locator('[data-owner-line]')).toHaveText(/^Move code /, { timeout: 30_000 })
  const code = /Move code ([A-Z0-9-]+)\./.exec(await settings.locator('[data-owner-line]').innerText())?.[1]
  if (code === undefined) throw new Error('No move code')
  await openChat(juno)
  await expect(chat.root.locator('[data-banner="otherDevice"]')).toBeVisible()
  await expect(chat.composer).toBeDisabled()

  const mac = await otherApp({ backupIntervalMs: 1_000 })
  {
    await ready(mac)
    await restartArmed(mac.app, point)
    await agentReady(mac.app)
    const page = await openSettings(mac, 'Backup & This Mac')
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    const restore = mac.win.getByRole('dialog', { name: 'Restore from backup' })
    await pickFolder(mac, shared)
    await restore.getByRole('button', { name: 'Choose folder' }).click()
    await restore.getByLabel('Recovery phrase').fill(phrase)
    await restore.getByLabel('The old Mac is off, erased, or has Juno removed').check()
    await restore.getByRole('button', { name: 'Restore', exact: true }).click()
    await expectArmedCrash(mac.app)
    await mac.win.keyboard.press('Escape')
    const restored = await openChat(mac)
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
    await mac.win.locator('main').getByRole('button', { name: 'Activate Juno' }).click()
    await openChat(mac)
    await expect(chip).toHaveCount(0)
    await restored.expectJuno('and tomorrow?')
    await expect(restored.ownerBubble('and tomorrow?')).toHaveCount(1)
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)
  }
})
