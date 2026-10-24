// The Juno header's switcher (SPEC 13.10) and Activity (13.9), in the app against the fake Slack and a
// fake OpenRouter: the panel moves to Activity and back in place beside the topic, a run opens in place,
// and in the Juno tab a switch is a history entry Back and Forward walk.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

const TOPIC = 'Draft plan is in the doc'

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.setWindowSize(1400)
}

/** Picks `label` from the switcher of the Juno header inside `where`. */
async function switchTo(juno: Juno, where: 'aside[data-juno-panel]' | 'main', label: string): Promise<void> {
  await juno.win.locator(`${where} [data-juno-header] button[aria-haspopup="menu"]`).click()
  await juno.win.getByRole('menu', { name: 'Juno pages' }).getByRole('menuitem', { name: label, exact: true }).click()
}

test('the panel switches to Activity and back in place, and a run says what started it, what it read and what it did', async ({ juno }) => {
  await ready(juno)
  await juno.sidebar.row(TOPIC).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.send('what is on today?')
  await panel.expectJuno('You said: what is on today?')

  // The switcher names the chat, and Activity opens in the panel: the topic stays beside it.
  const header = juno.win.locator('aside[data-juno-panel] [data-juno-header]')
  await expect(header.getByRole('button', { name: 'Juno', exact: true })).toBeVisible()
  await switchTo(juno, 'aside[data-juno-panel]', 'Activity')
  await expect(juno.win.locator('aside[data-juno-panel] [data-juno-header="activity"]')).toBeVisible()
  await expect(header.getByRole('button', { name: 'Juno · Activity' })).toBeVisible()
  // The switcher is a menu button, not a heading: the page's serif title is the panel's one h1.
  const panelHeadings = juno.win.locator('aside[data-juno-panel]').getByRole('heading', { level: 1 })
  await expect(panelHeadings).toHaveCount(1)
  await expect(panelHeadings).toHaveText('Activity')
  await juno.topic.expectTitle(TOPIC)

  // One row per run: the message's words, not "You"; what it read by name and how it ended; the model, quietly.
  const run = juno.win.locator('aside[data-juno-panel] [data-activity-run]').first()
  await expect(run.locator('[data-activity-trigger="message"]')).toHaveText('what is on today?')
  await expect(run.getByText('You', { exact: true })).toHaveCount(0)
  await expect(run.locator('[data-activity-summary]')).toHaveText(`Read ${TOPIC} · Replied`)
  await expect(run.locator('[data-activity-usage]')).not.toBeEmpty()

  // A click opens it in place, with the plain-words line for a run that read outside content.
  const toggle = run.getByRole('button', { expanded: false })
  await toggle.click()
  await expect(run.getByRole('button', { expanded: true })).toBeVisible()
  await expect(run.locator('[data-activity-tainted]')).toHaveText('Content Juno read in this run could hold instructions, so it asked before acting.')

  // Back to the chat, from the same place.
  await switchTo(juno, 'aside[data-juno-panel]', 'Chat')
  await panel.expectJuno('You said: what is on today?')
  await expect(juno.win.locator('aside[data-juno-panel] [data-juno-header="chat"]')).toBeVisible()
  await juno.topic.expectTitle(TOPIC)
})

test('in the Juno tab the switcher moves within the tab, and Back and Forward walk it', async ({ juno }) => {
  await ready(juno)
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(juno.win)
  await chat.send('hello there')
  await chat.expectJuno('You said: hello there')

  await switchTo(juno, 'main', 'Activity')
  await juno.tabs.expectActive('Activity')
  await expect(juno.win.locator('main [data-activity-run]').first().locator('[data-activity-trigger]')).toHaveText('hello there')
  // Every Juno page has the same switcher in the same place.
  await switchTo(juno, 'main', 'Scheduled')
  await juno.tabs.expectActive('Scheduled')
  await expect(juno.win.locator('main [data-juno-header="scheduled"]')).toBeVisible()

  await juno.nav.back()
  await juno.tabs.expectActive('Activity')
  await juno.nav.back()
  await chat.expectJuno('You said: hello there')
  await juno.nav.forward()
  await juno.tabs.expectActive('Activity')
  await switchTo(juno, 'main', 'Chat')
  await chat.expectJuno('You said: hello there')
})
