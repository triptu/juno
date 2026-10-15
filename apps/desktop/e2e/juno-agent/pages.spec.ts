// Settings › Juno and the Juno menu's pages in the app, against the agent's served pages.
// The menu's Settings and Connections open those sections of Settings.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

const openChat = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await openChat(juno)
}

const ruleFields = (juno: Juno) => juno.win.locator('main').getByLabel('Rule', { exact: true }).evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value))

async function openPage(juno: Juno, label: string): Promise<void> {
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: label }).click()
  await juno.tabs.expectActive(label === 'Settings' || label === 'Connections' ? 'Settings' : label)
}

test('Settings › Juno shows what is built, with the provider in use, and pauses Juno', async ({ juno }) => {
  await ready(juno)
  await openPage(juno, 'Settings')
  const page = juno.win.locator('main')
  await expect(page.getByRole('heading', { name: 'Juno', exact: true })).toBeVisible()
  for (const heading of ['Provider', 'Model', 'Spend', 'Codex', 'Rules', 'Pause']) await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  // Backup and This Mac are their own section.
  const sections = juno.win.getByRole('navigation', { name: 'Settings' })
  await sections.getByRole('button', { name: 'Backup & This Mac' }).click()
  for (const heading of ['Backup', 'This Mac']) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await sections.getByRole('button', { name: 'Juno' }).click()
  await expect(page.getByRole('heading', { name: 'Provider' })).toBeVisible()
  // The launch set OpenRouter up: its key is set and it is in use.
  await expect(page.locator('[data-provider-shown]')).toHaveAttribute('data-provider-shown', 'openRouter')
  await expect(page.locator('[data-provider-key]')).toHaveAttribute('data-provider-key', 'set')
  await expect(page.getByText('OpenRouter is in use.')).toBeVisible()

  // The chat model is one of the picker's families; the page follows the change.
  await page.getByLabel('Chat model').selectOption('Claude Opus')
  await expect(page.getByLabel('Chat model')).toHaveValue('Claude Opus')

  // A rule is saved when its field loses focus, and a removed one goes at once.
  await page.getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('Rule', { exact: true }).fill('Ask me before anything goes to #hiring')
  await page.getByLabel('Rule', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('Rule', { exact: true }).nth(1).fill('Never post in #general without asking')
  await page.getByLabel('Juno is paused').focus()
  await page.getByRole('button', { name: 'Remove rule' }).first().click()
  await expect(page.getByLabel('Rule', { exact: true })).toHaveCount(1)
  // What the agent kept: the page opened again shows only its served list.
  await juno.nav.back()
  await openPage(juno, 'Settings')
  await expect.poll(() => ruleFields(juno)).toEqual(['Never post in #general without asking'])

  // Pause shows in the chat's header, and its Resume undoes it.
  await page.getByLabel('Juno is paused').check()
  // A page opens in the tab it was asked from; Back returns to the chat.
  await juno.nav.back()
  const chip = juno.win.locator('main [data-banner="paused"]')
  await expect(chip).toBeVisible()
  await chip.getByRole('button', { name: 'Resume' }).click()
  await expect(chip).toHaveCount(0)
})

test('Activity lists the run a message started, and the other pages open', async ({ juno }) => {
  await ready(juno)
  const chat = JunoChatPane.tab(juno.win)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  await openPage(juno, 'Activity')
  await expect(juno.win.locator('main').getByText('You', { exact: true }).first()).toBeVisible()
  for (const label of ['What Juno remembers', 'Memory of this chat', 'Scheduled', 'Connections']) {
    await openChat(juno)
    await openPage(juno, label)
    await expect(juno.win.locator('main').getByRole('heading', { name: label, exact: true })).toBeVisible()
  }
})
