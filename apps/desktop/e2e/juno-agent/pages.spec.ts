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
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await openChat(juno)
}

const ruleFields = (juno: Juno) => juno.win.locator('main').getByLabel('Rule', { exact: true }).evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value))

async function openPage(juno: Juno, label: string): Promise<void> {
  await juno.win.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.win.getByRole('menuitem', { name: label }).click()
  await juno.tabs.expectActive(label === 'Settings' || label === 'Connections' ? 'Settings' : label)
}

// One launch walks the pages: a chat message and its run first, then the rules on Connections,
// then Settings, whose model change and Pause come last.
test('the Juno menu opens its pages: Activity, Connections rules and Settings › Juno', async ({ juno }) => {
  await ready(juno)
  await test.step('Activity lists the run a message started, and the other pages open', async () => {
    const chat = JunoChatPane.tab(juno.win)
    await chat.send('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    await openPage(juno, 'Activity')
    await expect(juno.win.locator('main [data-activity-trigger="message"]').first()).toHaveText('what is on today?')
    for (const label of ['What Juno remembers', 'Memory of this chat', 'Scheduled', 'Connections']) {
      await openChat(juno)
      await openPage(juno, label)
      await expect(juno.win.locator('main').getByRole('heading', { name: label, exact: true })).toBeVisible()
    }
  })
  await test.step('Connections starts with when Juno asks first, and saves your rules', async () => {
    await openChat(juno)
    await openPage(juno, 'Connections')
    const page = juno.win.locator('main')
    await expect(page.getByRole('heading', { name: 'When Juno asks first' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible()
    // A rule is saved when its field loses focus, and a removed one goes at once.
    await page.getByRole('button', { name: 'Add a rule' }).click()
    await page.getByLabel('Rule', { exact: true }).fill('Ask me before anything goes to #hiring')
    await page.getByLabel('Rule', { exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Add a rule' }).click()
    await page.getByLabel('Rule', { exact: true }).nth(1).fill('Never post in #general without asking')
    await page.getByLabel('Rule', { exact: true }).nth(1).blur()
    await page.getByRole('button', { name: 'Remove rule' }).first().click()
    await expect(page.getByLabel('Rule', { exact: true })).toHaveCount(1)
    // What the agent kept: the page opened again shows only its served list.
    await juno.nav.back()
    await openPage(juno, 'Connections')
    await expect.poll(() => ruleFields(juno)).toEqual(['Never post in #general without asking'])
  })
  await test.step('Settings › Juno shows what is built, with the provider in use, and pauses Juno', async () => {
    await openChat(juno)
    await openPage(juno, 'Settings')
    const page = juno.win.locator('main')
    await expect(page.getByRole('heading', { name: 'Juno', exact: true })).toBeVisible()
    for (const heading of ['Provider', 'Model', 'Spend', 'Codex', 'Pause Juno']) await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    // The owner's rules are on Connections.
    await expect(page.getByRole('heading', { name: 'When Juno asks first' })).toHaveCount(0)
    await expect(page.getByText('Use your ChatGPT plan instead of an API key.')).toBeVisible()
    await expect(page.getByText('Coming soon')).toBeVisible()
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

    // Pause shows in the chat's header, and its Resume undoes it.
    await page.getByLabel('Pause Juno').check()
    // A page opens in the tab it was asked from; Back returns to the chat.
    await juno.nav.back()
    const chip = juno.win.locator('main [data-banner="paused"]')
    await expect(chip).toBeVisible()
    await chip.getByRole('button', { name: 'Resume' }).click()
    await expect(chip).toHaveCount(0)
  })
})
