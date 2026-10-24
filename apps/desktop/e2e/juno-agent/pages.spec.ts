// Settings › Juno and the Juno menu's pages in the app, against the agent's served pages.
// The menu's Settings and Connections open those sections of Settings. Settings › Juno's
// model picker reads a catalogue with newer models, and Pause holds a message until Resume.
import { chatCopy } from '@juno/agent-contract'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { answer, expect, JunoChatPane, test as base } from './chat'
import { startScriptedModel, type CatalogueModel, type ScriptedModel } from './model'

const NEWER = 1_800_000_000

/** Newer models in four families: one fit to use, and three the picker must hide. */
function withNewer(models: ReadonlyArray<CatalogueModel>): ReadonlyArray<CatalogueModel> {
  const like = (id: string) => models.find((model) => model.id === id)!
  return [
    ...models,
    { ...like('anthropic/claude-sonnet-5.5'), id: 'anthropic/claude-sonnet-6', name: 'Anthropic: Claude Sonnet 6', created: NEWER },
    { ...like('anthropic/claude-opus-5.5'), id: 'anthropic/claude-opus-6:batch', name: 'Anthropic: Claude Opus 6 (batch)', created: NEWER },
    { ...like('x-ai/grok-4.7'), id: 'x-ai/grok-5', name: 'xAI: Grok 5', created: NEWER, supported_parameters: ['max_tokens'] },
    { ...like('meta/muse-wonder'), id: 'meta/muse-zenith', name: 'Meta: Muse Zenith', created: NEWER, context_length: 4_096 },
  ]
}

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer, catalogue: withNewer })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

const openChat = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()

async function ready(juno: Juno): Promise<void> {
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
// then Settings, whose model picker and Pause come last.
test('the Juno menu opens its pages: Activity, Connections rules, and Settings › Juno with its picker and Pause', async ({ juno, model }) => {
  await ready(juno)
  await test.step('Activity lists the run a message started, and the other pages open', () => walkPages(juno))
  await test.step('Connections starts with when Juno asks first, and saves your rules', () => saveRules(juno))
  await test.step('Settings › Juno shows the provider in use and the newest usable models, and Pause holds a message until Resume', () => settingsJuno(juno, model))
})

async function walkPages(juno: Juno): Promise<void> {
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
}

async function saveRules(juno: Juno): Promise<void> {
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
}

async function settingsJuno(juno: Juno, model: ScriptedModel): Promise<void> {
  await openChat(juno)
  await openPage(juno, 'Settings')
  const page = juno.win.locator('main')
  await expect(page.getByRole('heading', { name: 'Juno', exact: true })).toBeVisible()
  // The launch set OpenRouter up: its key is set and it is in use.
  await expect(page.locator('[data-provider-shown]')).toHaveAttribute('data-provider-shown', 'openRouter')
  await expect(page.locator('[data-provider-key]')).toHaveAttribute('data-provider-key', 'set')

  // The picker offers the newest usable model per family and hides batch, no-tools and small-window models.
  const names = () =>
    page
      .getByLabel('Chat model')
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.textContent!.split(' · ')[0]))
  await expect.poll(names, { timeout: 15_000 }).toEqual(['Claude Sonnet 6', 'Claude Opus 5.5', 'Muse Wonder', 'GPT-6.1 Sol', 'Grok 4.7'])
  await expect(page.getByLabel('Chat model').locator('option').filter({ hasText: /Codex/ })).toHaveCount(0)
  // The page follows a change of chat model.
  await page.getByLabel('Chat model').selectOption('Claude Opus')
  await expect(page.getByLabel('Chat model')).toHaveValue('Claude Opus')

  // Pause shows in the chat's header; a message waits for Resume, then runs.
  await page.getByLabel('Pause Juno').check()
  // A page opens in the tab it was asked from; Back returns to the chat.
  await juno.nav.back()
  const chip = juno.win.locator('main [data-banner="paused"]')
  await expect(chip).toHaveText(`${chatCopy.banner.paused.chip} · ${chatCopy.banner.paused.resume}`)
  const chat = JunoChatPane.tab(juno.win)
  const before = model.inputs().length
  await chat.send('anything new?')
  await expect(chat.ownerBubble('anything new?').locator('[data-delivery="waiting"]')).toHaveText(chatCopy.delivery.waiting.resume)
  expect(model.inputs()).toHaveLength(before)
  await chip.getByRole('button', { name: 'Resume' }).click()
  await expect(chip).toHaveCount(0)
  await chat.expectJuno('You said: anything new?')
  await expect(chat.ownerBubble('anything new?').locator('[data-delivery]')).toHaveCount(0)
}
