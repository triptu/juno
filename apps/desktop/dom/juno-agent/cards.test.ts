// The Budget card at the daily cap (plan v3 §16, flow 11): one test per button, since the
// agent makes one Budget card per day and raise.
import { answer, startScriptedModel } from '../../e2e/juno-agent/model'
import { card, openChat, openSettings, readySynced } from '../driver/agent'
import { expect } from '../expect'
import { domTest } from '../test'
import type { Juno } from '../driver/juno'

const model = () => startScriptedModel({ answer })

/** Settings › AI activity: a daily limit of $0, so the next request meets the cap. */
async function capAtZero(juno: Juno): Promise<void> {
  const settings = await openSettings(juno, 'AI activity')
  const cap = settings.getByLabel('Daily limit in dollars')
  await cap.fill('0')
  await cap.press('Enter')
  await expect(cap).toHaveValue('0')
}

domTest('at the daily cap the Budget card appears, and Allow $1 more lets the answer through', async ({ juno }) => {
  await readySynced(juno)
  await capAtZero(juno)

  const chat = await openChat(juno)
  await chat.send('what is on today?')
  const budget = card(chat, 'budget')
  await expect(budget).toHaveAttribute('data-card-status', 'open', { timeout: 15_000 })
  await expect(budget.getByText("Juno has used today's budget.", { exact: true })).toBeVisible()
  await expect(chat.junoBubble('You said: what is on today?')).toHaveCount(0)

  await budget.getByRole('button', { name: 'Allow $1 more today' }).click()
  await expect(budget.getByText('Allowed until midnight', { exact: true })).toBeVisible()
  // The next owner request has the increased allowance.
  await chat.send('and tomorrow?')
  await chat.expectJuno('and tomorrow?')
  await expect(card(chat, 'budget')).toHaveCount(1)
}, { model })

domTest('at the daily cap, Wait until tomorrow closes the Budget card and Juno stays quiet', async ({ juno, model }) => {
  await readySynced(juno)
  await capAtZero(juno)

  const chat = await openChat(juno)
  await chat.send('what is on today?')
  const budget = card(chat, 'budget')
  await expect(budget).toHaveAttribute('data-card-status', 'open', { timeout: 15_000 })
  await budget.getByRole('button', { name: 'Wait until tomorrow' }).click()
  await expect(budget).toHaveAttribute('data-card-status', 'dismissed')
  await expect(budget.getByText('Dismissed', { exact: true })).toBeVisible()
  expect(model.inputs().filter((input) => input.includes('what is on today?'))).toEqual([])
}, { model })
