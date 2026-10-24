// Setting up a model provider as a first-time user does (SPEC 13.10): "Set up Juno" right
// after the first Slack sign-in, or Skip for now and later "Juno needs a model", the provider
// section of Settings › Juno, then the chat.
import { startFakeOpenAi } from '@juno/agent-testing/openai'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { expect, hooks, test as base } from '../fixtures'
import { answer, JunoChatPane } from './chat'

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'
const POSTGRES = 'Draft plan is in the doc'

/** The app with no provider set up, and a fake OpenRouter to set up. */
const test = base.extend<{ readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  agentOptions: async ({ model }, use) => use({ fakeOpenRouterUrl: model.origin }),
})

test.describe.configure({ timeout: 90_000 })

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

test('after Skip for now the tab and the panel say Juno needs a model, and Add a provider sets one up', { tag: '@canary' }, async ({ juno, model }) => {
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
  await juno.setUp.getByRole('button', { name: 'Skip for now' }).click()
  await juno.waitForSync()
  expect(await hooks(juno.surface, 'agentState')).toBe('stopped')
  // AI assist stays on: Home writes to Juno by default.
  await juno.home.open()
  await juno.write.expectDestination('Juno')
  await juno.setWindowSize(1400, 900)

  // The panel beside a topic says so too, with no composer.
  await juno.sidebar.row(POSTGRES).open()
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
})

test('after sign-in, Set up Juno takes an OpenRouter key and the default model, and the first chat is answered', async ({ juno, model }) => {
  await juno.signIn({ skipSetUp: false })
  const { setUp } = juno
  await expect(setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
  // Codex is not installed under tests, so two choices.
  await expect(setUp.getByRole('radio')).toHaveText(['OpenRouter', 'OpenAI-compatible'])
  await expect(setUp.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await setUp.getByLabel('API key').fill(KEY)
  await setUp.getByLabel('API key').press('Enter')
  // Saved: the agent starts, and the model row offers its models with Sonnet chosen.
  const select = setUp.locator('[data-set-up-model]').getByRole('combobox', { name: 'Model' })
  await expect(select).toBeVisible({ timeout: 20_000 })
  await expect(select.locator('option:checked')).toHaveText(/^Claude Sonnet/)
  await setUp.getByRole('button', { name: 'Continue' }).click()

  // The app, with Juno ready on the key just saved.
  await juno.waitForSync()
  await junoNav(juno).click()
  const chat = JunoChatPane.tab(juno.win)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  expect(model.requests.at(-1)?.key).toBe(KEY)
})

test('an OpenAI-compatible endpoint that lists no models takes a typed model id', async ({ juno }) => {
  const endpoint = await startFakeOpenAi({ models: null, answer: '<say>Hello from the local model.</say>' })
  try {
    await juno.signIn()
    await juno.waitForSync()
    await junoNav(juno).click()
    await juno.win.locator('main [data-juno-no-provider]').getByRole('button', { name: 'Add a provider' }).click()
    const page = juno.win.locator('main')
    await page.getByRole('radio', { name: 'OpenAI-compatible' }).click()
    await page.getByLabel('Base URL').fill('not an address')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('[data-provider-error]')).toHaveText('Enter an http or https address.')
    await page.getByLabel('Base URL').fill(endpoint.baseUrl)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')

    // The endpoint lists nothing: the model id is typed, and compaction uses it.
    const modelId = page.getByLabel('Model id')
    await expect(modelId).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Compaction model')).toHaveCount(0)
    await expect(page.locator('[data-spend-untracked]')).toBeVisible()
    await modelId.fill('mistral-small')
    await modelId.press('Enter')
    await expect.poll(() => modelId.inputValue()).toBe('mistral-small')

    await junoNav(juno).click()
    const chat = JunoChatPane.tab(juno.win)
    await chat.send('hello')
    await chat.expectJuno('Hello from the local model.')
    expect(endpoint.requests.map((request) => request.model)).toEqual(['mistral-small'])
    await juno.openSettings('Juno')
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => hooks(juno.surface, 'agentState')).toBe('stopped')
    await junoNav(juno).click()
    await expect(juno.win.locator('main [data-juno-no-provider]')).toContainText('Juno needs a model')
  } finally {
    await endpoint.close()
  }
})
