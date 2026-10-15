// Plan flow 14: move between two Macs through Settings, then review the restored chat.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import { Juno } from '../driver/juno'
import { launchApp, tempUserData } from '../fixtures'
import { agentReady, card, expectArmedCrash, openChat, openSettings, ready, restartArmed } from './agent'
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
  // oxlint-disable-next-line no-empty-pattern
  shared: async ({}, use) => {
    const folder = await mkdtemp(join(tmpdir(), 'juno-move-'))
    try { await use(folder) } finally { await rm(folder, { recursive: true, force: true }) }
  },
  running: async ({ fake, slackApp, userData, model }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin, backupIntervalMs: 1_000 })
    try { await use(running) } finally { await running.close() }
  },
})

test.describe.configure({ timeout: 180_000 })

async function pickFolder(juno: Juno, folder: string): Promise<void> {
  await juno.app.evaluate((_electron, path) => {
    const state = globalThis as unknown as { junoTest: { folder: { next: string | null | undefined } } }
    state.junoTest.folder.next = path
  }, folder)
}

for (const point of [undefined, 'restore.staged', 'restore.swapped'] as const) {
test(`a move restores the chat and pending cards for review${point === undefined ? '' : ` after a crash at ${point}`}`,  async ({ juno, fake, slackApp, model, shared }) => {
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
  await expect(settings.locator('[data-backup-folder]')).toHaveText(shared)
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

  const other = await tempUserData()
  const second = await launchApp(other, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin, backupIntervalMs: 1_000 })
  try {
    const mac = new Juno(second.app, second.win)
    await ready(mac)
    if (point !== undefined) {
      await restartArmed(second.app, point)
      await agentReady(second.app)
    }
    const page = await openSettings(mac, 'Backup & This Mac')
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    const restore = mac.win.getByRole('dialog', { name: 'Restore from backup' })
    await pickFolder(mac, shared)
    await restore.getByRole('button', { name: 'Choose folder' }).click()
    await restore.getByLabel('Recovery phrase').fill(phrase)
    await restore.getByLabel('The old Mac is off, erased, or has Juno removed').check()
    await restore.getByRole('button', { name: 'Restore', exact: true }).click()
    if (point !== undefined) {
      await expectArmedCrash(second.app)
      await mac.win.keyboard.press('Escape')
    } else await mac.tabs.expectActive('Review')
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
  } finally {
    await second.close()
    await rm(other, { recursive: true, force: true })
  }
})

}
