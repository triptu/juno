// A model provider set up from "Juno needs a model" (SPEC 13.10): an OpenAI-compatible endpoint
// that lists no models takes a typed model id, and Remove stops the agent. "Set up Juno" right after
// the first sign-in is in `e2e/juno-agent/providers-ui.spec.ts`: it decides on the provider state the
// page has when the import is clicked, and the DOM driver clicks before that state arrives.
import { startFakeOpenAi } from '@juno/agent-testing/openai'
import { hooks } from '../../e2e/hooks'
import { JunoChatPane } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

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
