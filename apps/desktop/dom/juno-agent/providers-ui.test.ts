// Setting up a model provider (SPEC 13.10): "Set up Juno" right after the first sign-in. Skip for now
// is in `e2e/juno-agent/providers-ui.spec.ts`.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
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
