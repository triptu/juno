// "Set up Juno" right after the first Slack sign-in (SPEC 13.10), as a new
// user meets it: an OpenRouter key and the default model, then the first
// chat; or Skip for now, after which the Juno tab says Juno needs a model.
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { expect, hooks, launchApp, test as base } from '../fixtures'
import { answer, JunoChatPane } from './chat'

const KEY = 'sk-or-v1-e2e0123456789abcdef0123456789abcdef'

/** The app with no provider set up, and a fake OpenRouter to set up. */
const test = base.extend<{ readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  running: async ({ fake, slackApp, userData, model }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeOpenRouterUrl: model.origin })
    await use(running)
    await running.close()
  },
})

test.describe.configure({ timeout: 90_000 })

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

test('after sign-in, Set up Juno takes an OpenRouter key and the default model, and the first chat is answered', async ({ juno, model }) => {
  await juno.signIn({ skipSetUp: false })
  const { setUp } = juno
  await expect(setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
  // Codex is not installed under tests, so two choices.
  await expect(setUp.getByRole('radio')).toHaveText(['OpenRouter', 'OpenAI-compatible'])
  await expect(setUp.getByRole('button', { name: 'Continue' })).toBeDisabled()

  // A bad key says why, and nothing is saved.
  await setUp.getByLabel('API key').fill('two words')
  await setUp.getByRole('button', { name: 'Continue' }).click()
  await expect(setUp.locator('[data-sign-in-error]')).toHaveText('That is not a key. Keys have no spaces.')
  expect(await hooks(juno.app, 'agentState')).toBe('stopped')

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

test('after sign-in, Skip for now leaves AI assist on, and the Juno tab says Juno needs a model', async ({ juno }) => {
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp.getByRole('heading', { name: 'Set up Juno' })).toBeVisible({ timeout: 15_000 })
  await juno.setUp.getByRole('button', { name: 'Skip for now' }).click()

  await juno.waitForSync()
  expect(await hooks(juno.app, 'agentState')).toBe('stopped')
  // AI assist stays on: Home offers Ask Juno, and Juno asks for a model.
  await expect(juno.home.ask).toBeVisible()
  await junoNav(juno).click()
  const empty = juno.win.locator('main [data-juno-no-provider]')
  await expect(empty).toContainText('Juno needs a model')
  await expect(empty.getByRole('button', { name: 'Add a provider' })).toBeVisible()
})
