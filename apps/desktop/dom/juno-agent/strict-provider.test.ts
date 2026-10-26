// Setting up a model provider as a first-time user does (SPEC 13.10): Skip for now on "Set up Juno" after the first
// Slack sign-in, then "Juno needs a model" in the Juno tab and the panel, Add a provider in Settings › Juno with a
// bad key refused, and the chat on the chosen model. Set up Juno itself and an endpoint with a typed model id are in
// `providers-ui.test.ts`.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { hooks } from '../../e2e/hooks'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'
const POSTGRES = 'Draft plan is in the doc'

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

domTest('after Skip for now the tab and the panel say Juno needs a model, and Add a provider sets one up', async ({ juno, model }) => {
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
  await juno.setUp.getByRole('button', { name: 'Skip for now' }).click()
  await juno.waitForSync()
  expect(await hooks(juno.surface, 'agentState')).toBe('stopped')
  // AI assist stays on: Home writes to Juno by default.
  await juno.home.open()
  await juno.write.expectDestination('Juno')

  // The panel beside a topic says so too, with no composer.
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  await expect(juno.win.locator('aside [data-juno-no-provider]')).toContainText('Juno needs a model')
  await expect(juno.win.locator('aside textarea')).toHaveCount(0)
  await juno.tabs.menu('juno')

  await junoNav(juno).click()
  const empty = juno.win.locator('main [data-juno-no-provider]')
  await expect(empty).toContainText('Juno needs a model')
  await empty.getByRole('button', { name: 'Add a provider' }).click()
  await juno.tabs.expectActive('Settings')

  // Settings opens at Juno with the key field focused. With no agent running the page is the provider section alone.
  const page = juno.win.locator('main')
  await expect(juno.win.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Juno' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('API key')).toBeFocused()
  await expect(page.locator('[data-provider-shown]')).toHaveAttribute('data-provider-shown', 'openRouter')
  await expect(page.getByRole('heading', { name: 'Model' })).toHaveCount(0)
  await page.getByLabel('API key').fill('two words')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('[data-provider-error]')).toHaveText('That is not a key. Keys have no spaces.')
  await page.getByLabel('API key').fill(KEY)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('[data-provider-key]')).toHaveAttribute('data-provider-key', 'set')
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
  // The agent's part of the page arrives once it runs.
  await expect(page.getByRole('heading', { name: 'Model' })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Chat model', { exact: true }).selectOption('Claude Opus')

  await junoNav(juno).click()
  const chat = JunoChatPane.tab(juno.win)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  expect(model.requests.at(-1)?.key).toBe(KEY)
  expect(model.requests.filter((request) => !request.model.includes('haiku')).at(-1)?.model).toBe('anthropic/claude-opus-5.5')
}, { synced: false, model: () => startFakeOpenRouter({ answer }), engine: { agent: false }, timeout: 90_000 })
