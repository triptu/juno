// Setting up a model provider (SPEC 13.10): "Set up Juno" right after the first sign-in, and from
// "Juno needs a model" an OpenAI-compatible endpoint that lists no models takes a typed model id, and
// Remove stops the agent. Skip for now is in `strict-provider.test.ts`.
import { startFakeOpenAi } from '@juno/agent-testing/openai'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { hooks } from '../../e2e/hooks'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

// The driver presses sign in as soon as the page shows it, before main's provider state reaches
// the page: Set up Juno is decided when that state arrives, not from the state at the press.
domTest('after sign-in, Set up Juno takes an OpenRouter key and the default model, and the first chat is answered', async ({ juno, model }) => {
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
  await expect.poll(() => (select.all()[0] as HTMLSelectElement | undefined)?.selectedOptions[0]?.textContent).toMatch(/^Claude Sonnet/)
  await setUp.getByRole('button', { name: 'Continue' }).click()

  // The app, with Juno ready on the key just saved.
  await juno.waitForSync()
  await junoNav(juno).click()
  const chat = JunoChatPane.tab(juno.win)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  expect(model.requests.at(-1)?.key).toBe(KEY)
}, { synced: false, model: () => startFakeOpenRouter({ answer }), engine: { agent: false }, timeout: 90_000 })

domTest('an OpenAI-compatible endpoint that lists no models takes a typed model id', async ({ juno }) => {
  const endpoint = await startFakeOpenAi({ models: null, answer: '<say>Hello from the local model.</say>' })
  try {
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
}, { timeout: 90_000 })
