// The Juno panel beside a topic, in the app against the fake Slack and a fake OpenRouter: opening
// and closing it, its width, its draft and state per tab, what Juno sees from the topic and a
// selection, its first frame, dark mode, and Ask Juno from a person, channel or message menu.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const panelOf = (juno: Juno) => juno.win.locator('aside[data-juno-panel]')

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.setWindowSize(width)
}

test('opens and closes the panel, adapts to width, names its topic and keeps state per tab', async ({ juno, model }) => {
  await ready(juno)
  await test.step('⌘J opens the panel beside a topic with its composer focused, Esc closes an emoji list first, and Esc in the empty composer closes the panel', () => openAndClosePanel(juno, model))
  await test.step('the panel covers the topic when the topic would keep less than 480px, keeping its draft and focus', () => resizePanel(juno))
  await test.step('the topic chip in the panel composer names the topic Juno sees', () => readTopicChip(juno))
  await test.step('the panel is open in one tab and closed in another, and each keeps its state and draft across a tab switch', () => keepPanelPerTab(juno))
})

async function openAndClosePanel(juno: Juno, model: { readonly inputs: () => ReadonlyArray<string> }): Promise<void> {
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)

  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  await expect(panel.composer).toHaveAttribute('placeholder', 'Ask about this topic')
  // Beside the topic: 440px, and the topic keeps its header.
  await expect.poll(() => panelOf(juno).evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
  await expect(juno.win.locator('[data-topic-header]')).toBeVisible()

  // Enter takes an emoji suggestion without sending, and Esc closes the list, not the panel.
  const emoji = juno.win.getByRole('listbox', { name: 'Emoji' })
  await panel.composer.pressSequentially('nice :thumbs')
  await expect(emoji).toBeVisible()
  await panel.composer.press('Enter')
  await expect(panel.composer).toHaveValue(/^nice 👍 $/)
  await panel.composer.pressSequentially(':smi')
  await expect(emoji).toBeVisible()
  await panel.composer.press('Escape')
  await expect(emoji).toHaveCount(0)
  await expect(panelOf(juno)).toHaveCount(1)
  await expect(panel.composer).toHaveValue('nice 👍 :smi')
  expect(model.inputs()).toHaveLength(0)

  await panel.composer.fill('')
  await panel.composer.press('Escape')
  await expect(panelOf(juno)).toHaveCount(0)

  // The header's Juno button opens it too, and ⌘J closes it.
  await juno.win.locator('[data-topic-header]').getByRole('button', { name: 'Juno ⌘J' }).click()
  await expect(panel.composer).toBeFocused()
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)

  // Outside a topic tab, ⌘J opens the Juno tab.
  await junoNav(juno).click()
  await juno.tabs.menu('juno')
  await juno.tabs.expectActive('Juno')
}

async function resizePanel(juno: Juno): Promise<void> {
  await setWindowWidth(juno, 1100)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = panelOf(juno)
  const page = juno.win.locator('main')
  // Covering: the page's width less the 8px inset each side, and the page keeps its full width under it.
  const width = (locator: typeof page) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  await expect.poll(async () => (await width(panel)) === (await width(page)) - 16).toBe(true)
  expect(await width(page)).toBeLessThan(856)
  // A draft and focus survive crossing the cover breakpoint both ways.
  const composer = JunoChatPane.panel(juno.win).composer
  await expect(composer).toBeFocused()
  await composer.fill('Half written question')
  for (const next of [1400, 900, 1600]) {
    await setWindowWidth(juno, next)
    await expect.poll(() => juno.win.evaluate(() => innerWidth)).toBeLessThanOrEqual(next)
    await expect(composer).toHaveValue('Half written question')
    await expect(composer).toBeFocused()
  }
  await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
  await composer.fill('')
}

async function readTopicChip(juno: Juno): Promise<void> {
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  const line = juno.win.locator('[data-panel-sees]')
  await expect(line).toHaveText(/^eng · Draft plan is in the doc/)
  await expect(line).toHaveAttribute('data-tooltip', /^Juno sees eng · Draft plan is in the doc/)
}

async function keepPanelPerTab(juno: Juno): Promise<void> {
  await setWindowWidth(juno, 1400)
  const panel = panelOf(juno)
  await juno.sidebar.row(POSTGRES).open()
  await expect(panel).toHaveCount(1)
  await JunoChatPane.panel(juno.win).composer.fill('Kept while away')
  // A second topic in a new tab: the panel is closed there.
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.expectTitle(RINA)
  await expect(panel).toHaveCount(0)
  // Back to the first tab: still open, with its draft. And to the second: still closed.
  await juno.tabs.select(POSTGRES)
  await expect(panel).toHaveCount(1)
  await expect(JunoChatPane.panel(juno.win).composer).toHaveValue('Kept while away')
  await juno.tabs.select('Rina finished the onsite')
  await expect(panel).toHaveCount(0)
}

test('two tabs on one topic with the panel open in one: send, react and edit stay in step', async ({ juno, fake }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row('#eng').open()
  await juno.tabs.menu('juno')
  await juno.sidebar.row('#eng').openInNewTab()
  await expect(juno.tabs.tab('eng')).toHaveCount(2)
  await expect(panelOf(juno)).toHaveCount(0)
  await juno.topic.send('Sent from the plain tab')
  await juno.topic.expectSent('Sent from the plain tab')
  await (await juno.topic.messageMenu('Sent from the plain tab')).react('+1')
  await expect.poll(() => fake.messages('C0ENG').find((m) => m.text === 'Sent from the plain tab')?.reactions?.length ?? 0).toBe(1)

  await juno.tabs.selectAt('eng', 0)
  await expect(panelOf(juno)).toHaveCount(1)
  const there = juno.topic.message('Sent from the plain tab')
  await expect(there).toBeVisible()
  await expect(there.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
  await juno.topic.chooseInMessageMenu('Sent from the plain tab', 'edit')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await edit.fill('Edited beside the panel')
  await edit.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Edited beside the panel')).toBe(true)
  await juno.tabs.selectAt('eng', 1)
  await juno.topic.expectMessage('Edited beside the panel')
  await expect(juno.topic.message('Edited beside the panel').getByRole('button', { name: '1 👍, including you' })).toBeVisible()
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
  // The composer adds the selection, quoted with its sender, with the whole of it as its tooltip.
  await expect(juno.win.locator('[data-panel-selection]')).toHaveText('Leo: “logical replication”')
  await expect(juno.win.locator('[data-panel-selection]')).toHaveAttribute('data-tooltip', 'Leo: logical replication')

  await panel.send('is this settled?')
  await expect(panel.ownerBubble('is this settled?').locator('[data-about]')).toHaveText(/^About Draft plan is in the doc/)
  await panel.expectJuno('You said: is this settled?')
  const input = model.inputs().at(-1)!
  expect(input).toMatch(/^<message id="n1"><about topic="t:[^"]+" title="Draft plan is in the doc[^"]*" channel="#eng" channel-id="[^"]+" kind="thread" visible="[^"]+"><selection from="Leo" ts="[^"]+">logical replication<\/selection><\/about>is this settled\?<\/message>$/)
  await expect(juno.win.locator('[data-panel-selection]')).toHaveCount(0)

  // The same chat in the Juno tab shows the About line, and it opens the topic.
  await panel.root.getByRole('button', { name: 'Open in a tab' }).click()
  await juno.tabs.expectActive('Juno')
  const tab = JunoChatPane.tab(juno.win)
  await tab.ownerBubble('is this settled?').locator('[data-about]').click()
  await juno.topic.expectTitle(POSTGRES)
})

test('the panel opens at the newest message on its first frame, with no jump, when its chat has history to scroll, and has no light surface in dark mode', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  // Long enough bubbles that each grows past its size estimate once it is laid out.
  const asks = Array.from({ length: 10 }, (_, i) => `question ${i + 1}: what did Leo and Maya decide about the cutover window, the fallback primary and who reviews the plan before Thursday`)
  for (const ask of asks) {
    await panel.send(ask)
    await panel.expectJuno(`You said: ${ask}`)
  }
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)

  // After each painted frame: how far the panel's list is from its end, and whether the newest bubble is in view.
  await juno.win.evaluate(() => {
    const frames: Array<{ atEnd: boolean; lastInView: boolean }> = []
    ;(window as unknown as { panelFrames: typeof frames }).panelFrames = frames
    const afterPaint = () => {
      const scroller = document.querySelector<HTMLElement>('aside[data-juno-panel] [data-scroll]')
      const last = scroller?.querySelectorAll('[data-chat-juno]')
      const row = last?.[last.length - 1]
      if (scroller != null && row !== undefined && scroller.getClientRects().length > 0) {
        const box = scroller.getBoundingClientRect()
        const at = row.getBoundingClientRect()
        frames.push({ atEnd: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1, lastInView: at.bottom <= box.bottom + 1 && at.top >= box.top })
      }
      if (frames.length < 10) requestAnimationFrame(() => setTimeout(afterPaint, 0))
    }
    requestAnimationFrame(() => setTimeout(afterPaint, 0))
  })
  await juno.tabs.menu('juno')
  await expect.poll(() => juno.win.evaluate(() => (window as unknown as { panelFrames: unknown[] }).panelFrames.length)).toBe(10)
  const frames = await juno.win.evaluate(() => (window as unknown as { panelFrames: Array<{ atEnd: boolean; lastInView: boolean }> }).panelFrames)
  // The scroller has more than a screenful, and every frame from the first shows its end.
  expect(await panel.root.locator('[data-scroll]').evaluate((el) => el.scrollHeight > el.clientHeight * 1.5)).toBe(true)
  expect(frames).toEqual(Array.from({ length: 10 }, () => ({ atEnd: true, lastInView: true })))

  // In dark mode no light surface shows anywhere in the panel. Settings takes the tab, so the topic comes back with the panel closed.
  await juno.setTheme('Dark')
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  await expect(panel.composer).toBeFocused()
  const light = await panelOf(juno).evaluate((root) => {
    const found: string[] = []
    for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      if (!element.checkVisibility({ opacityProperty: true, contentVisibilityAuto: true })) continue
      const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor)
      if (match === null || (match[4] !== undefined && Number(match[4]) < 0.5)) continue
      const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
      if (0.2126 * r + 0.7152 * g + 0.0722 * b > 200) found.push(element.tagName.toLowerCase())
    }
    return found
  })
  expect(light).toEqual([])
})

test('Ask Juno in a person menu opens the panel with an About chip, the message is about that person, and the chip stays in its tab', async ({ juno, model }) => {
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

  // It does not follow to the panel of another tab, which asks about its own topic.
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.expectTitle(RINA)
  await juno.tabs.menu('juno')
  await expect(panel.composer).toBeFocused()
  await expect(juno.win.locator('[data-panel-sees]')).toHaveText(/^\S+ · Rina finished the onsite/)
  await expect(panel.root.locator('[data-about-chip]')).toHaveCount(0)
  await panel.send('what happened here?')
  await panel.expectJuno('You said: what happened here?')
  expect(model.inputs().at(-1)!).toMatch(/<about topic="t:[^"]+" title="Rina finished the onsite/)
  await juno.tabs.select(POSTGRES)
  await expect(juno.win.locator('[data-about-chip="person"]')).toHaveText('About Leo')
})

test('Ask Juno in the channel menu on the context pill asks about the channel, closing the panel drops the chip, and Ask Juno in a message menu quotes it', async ({ juno, model, slack }) => {
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

  // Ask Juno in a message's menu quotes the message beside its topic.
  slack.as('Maya').dm('Are we still on for the board deck review?')
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectMessage('Are we still on for the board deck review?')
  await juno.topic.chooseInMessageMenu('Are we still on for the board deck review?', 'ask-juno')
  const quote = panelOf(juno).locator('[data-panel-selection]')
  await expect(quote).toContainText(/^Maya[^:]*: “Are we still on for the…”$/)
  await expect(quote).toHaveAttribute('data-tooltip', /^Maya[^:]*: Are we still on for the board deck review\?/)
  await expect(panel.composer).toBeFocused()
})
