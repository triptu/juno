// The Juno chat in the app against the fake Slack and a fake OpenRouter:
// the Juno tab, the panel beside a topic, and Ask Juno from a menu.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, w) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(w, window.getSize()[1]!)
  }, width)
}

test('the Juno tab sends a message at once and shows the answer, both ways a reaction and a reply', async ({ juno, model }) => {
  await ready(juno)
  await junoNav(juno).click()
  await juno.tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.composer).toBeFocused()

  await chat.send('what is on today?')
  await chat.expectOwner('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  expect(model.inputs().at(-1)).toBe('<message id="n1">what is on today?</message>')

  // Juno reacts to the owner: the badge sits on the owner's bubble.
  await chat.send('please react')
  await chat.expectJuno('Reacted to please react')
  await expect(chat.ownerBubble('please react').getByLabel('Reacted 🎉')).toBeVisible()

  // The owner reacts to Juno: the badge shows at once, and Juno hears it.
  await chat.react('You said: what is on today?', '🎉')
  await expect(chat.junoBubble('You said: what is on today?').getByLabel('Reacted 🎉')).toBeVisible()
  await expect.poll(() => model.inputs().some((input) => input.startsWith('<reaction') && input.includes('emoji="🎉"'))).toBe(true)

  // A reply quotes the bubble in the composer and over the sent bubble, and Juno gets the bubble in full.
  await chat.reply('You said: what is on today?')
  await expect(chat.root.locator('[data-composer-quote]')).toContainText('You said: what is on today?')
  await chat.send('which one?')
  await expect(chat.ownerBubble('which one?').locator('[data-quote="bubble"]')).toContainText('You said: what is on today?')
  await expect.poll(() => model.inputs().at(-1)).toContain('<quote from="juno">You said: what is on today?</quote>which one?')
})

test('⌘J opens the panel beside a topic with its composer focused, and Esc in the empty composer closes it', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)

  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await expect(panel.composer).toHaveAttribute('placeholder', 'Ask about this topic')
  // Beside the topic: 360px, and the topic keeps its header.
  await expect.poll(() => juno.win.locator('aside[data-juno-panel]').evaluate((el) => el.getBoundingClientRect().width)).toBe(360)
  await expect(juno.win.locator('[data-topic-header]')).toBeVisible()

  await panel.composer.press('Escape')
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(0)

  // The header's Juno button opens it too, and ⌘J closes it.
  await juno.win.locator('[data-topic-header]').getByRole('button', { name: 'Juno ⌘J' }).click()
  await expect(panel.composer).toBeFocused()
  await juno.tabs.menu('juno')
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(0)

  // Outside a topic tab, ⌘J opens the Juno tab.
  await junoNav(juno).click()
  await juno.tabs.menu('juno')
  await juno.tabs.expectActive('Juno')
})

test('the panel covers the topic when the topic would keep less than 480px', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1100)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = juno.win.locator('aside[data-juno-panel]')
  const page = juno.win.locator('main')
  // Covering: as wide as the page, which keeps its full width under it.
  const width = (locator: typeof page) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  await expect.poll(async () => (await width(panel)) === (await width(page))).toBe(true)
  expect(await width(page)).toBeLessThan(840)
  await setWindowWidth(juno, 1600)
  await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().width)).toBe(360)
})

test('a message sent from the panel is about the topic, with the selection, and says so over the bubble', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  // Select words in the topic, then open the panel: the quote shows above its composer.
  await juno.topic.message('logical replication').evaluate((el) => {
    const text = [...el.querySelectorAll('*')].map((node) => node.firstChild).find((node) => node?.nodeType === Node.TEXT_NODE && node.textContent?.includes('logical replication'))!
    const at = text.textContent!.indexOf('logical replication')
    const range = document.createRange()
    range.setStart(text, at)
    range.setEnd(text, at + 'logical replication'.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(juno.win.locator('[data-panel-selection]')).toContainText('logical replication')
  await expect(juno.win.locator('[data-panel-selection]')).toContainText('Leo')

  await panel.send('is this settled?')
  await expect(panel.ownerBubble('is this settled?').locator('[data-about]')).toHaveText(/^About Draft plan is in the doc/)
  await panel.expectJuno('You said: is this settled?')
  const input = model.inputs().at(-1)!
  expect(input).toMatch(/^<message id="n1"><about topic="t:[^"]+" title="Draft plan is in the doc[^"]*" channel="#eng" channel-id="[^"]+" kind="thread" visible="[^"]+"><selection from="Leo">logical replication<\/selection><\/about>is this settled\?<\/message>$/)
  await expect(juno.win.locator('[data-panel-selection]')).toHaveCount(0)

  // The same chat in the Juno tab shows the About line, and it opens the topic.
  await panel.root.getByRole('button', { name: 'Open in a tab' }).click()
  await juno.tabs.expectActive('Juno')
  const tab = JunoChatPane.tab(juno.win)
  await tab.ownerBubble('is this settled?').locator('[data-about]').click()
  await juno.topic.expectTitle(POSTGRES)
})

test('a topic opened at its "new" divider offers Catch me up in the panel, once', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(RINA).open()
  await juno.topic.expectNew(2)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await juno.win.locator('[data-catch-me-up]').click()
  await panel.expectJuno('You said: Catch me up')
  expect(model.inputs().at(-1)!).toMatch(/ new-from="[^"]+"/)
  await expect(juno.win.locator('[data-catch-me-up]')).toHaveCount(0)
})

test('Ask Juno in a person menu opens the panel with an About chip, and the message is about that person', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.chooseNextMenuItem('ask-juno')
  await juno.win.locator('[data-topic-view] [data-person-name="Leo"]').first().click({ button: 'right' })

  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')
  await panel.send('what is he working on?')
  await expect(panel.ownerBubble('what is he working on?').locator('[data-about]')).toHaveText('About Leo')
  await panel.expectJuno('You said: what is he working on?')
  expect(model.inputs().at(-1)!).toBe('<message id="n1"><about person="U0LEO" name="Leo"/>what is he working on?</message>')
  // The chip stays until removed.
  await expect(juno.win.locator('[data-about-chip="person"]')).toBeVisible()
})

test('Ask Juno in the channel menu on the context pill asks about the channel, and closing the panel drops the chip', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.chooseNextMenuItem('ask-juno')
  await juno.win.locator('[data-topic-header]').getByRole('button', { name: /^eng, public channel/ }).click({ button: 'right' })

  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await expect(panel.root.locator('[data-about-chip="channel"]')).toHaveText('About #eng')
  await panel.send('anything new here?')
  await panel.expectJuno('You said: anything new here?')
  expect(model.inputs().at(-1)!).toMatch(/^<message id="n1"><about channel="[^"]+" name="#eng"\/>anything new here\?<\/message>$/)

  await juno.tabs.menu('juno')
  await juno.tabs.menu('juno')
  await expect(panel.composer).toBeFocused()
  await expect(panel.root.locator('[data-about-chip]')).toHaveCount(0)
})
