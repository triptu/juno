// The Juno chat in the app against the fake Slack and a fake OpenRouter:
// the Juno tab, the panel beside a topic, a question written on Home, and
// Ask Juno from a menu.
import type { Locator } from '@playwright/test'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

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

test('a question written on Home goes to the Juno chat, with the field where Home’s was, and Back returns to Home', async ({ juno }) => {
  await ready(juno)
  const { write, tabs } = juno
  await juno.expectNothingOpen()
  await write.expectDestination('Juno')
  await write.write('#eng what happened today?')
  const before = await write.field.boundingBox()
  await write.send()
  await tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await chat.expectOwner('#eng what happened today?')
  await chat.expectJuno('You said: #eng what happened today?')
  const after = await chat.root.locator('[data-composer-field]').boundingBox()
  const edges = (box: typeof before) => ({ x: box?.x, width: box?.width, bottom: (box?.y ?? 0) + (box?.height ?? 0) })
  expect(edges(after)).toEqual(edges(before))
  await juno.nav.back()
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')
})

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

  // Markdown bold and the HTML bold models write both show as bold words, with no markup on screen.
  await chat.send('show formatting')
  const rich = chat.junoBubble('Staging is green, and deploys run at 14:00.')
  await expect(rich).toBeVisible({ timeout: 15_000 })
  await expect(rich.locator('strong')).toHaveText(['Staging', 'deploys'])
  await expect(rich.locator('strong').first()).toHaveCSS('font-weight', '600')
  await expect(rich).not.toContainText('<')
  await expect(rich).not.toContainText('*')
})

test('two Juno tabs show the one chat: a message sent in one shows in both', async ({ juno }) => {
  await ready(juno)
  await junoNav(juno).click()
  await juno.tabs.expectActive('Juno')
  // ⌘-click opens a second Juno tab; a plain click focuses the one active last.
  await junoNav(juno).click({ modifiers: ['Meta'] })
  await expect(juno.tabs.tab('Juno')).toHaveCount(2)
  await juno.tabs.expectActiveAt('Juno', 1)

  const chat = JunoChatPane.tab(juno.win)
  await chat.send('sent from the second tab')
  await chat.expectOwner('sent from the second tab')
  await chat.expectJuno('You said: sent from the second tab')

  await juno.tabs.selectAt('Juno', 0)
  await juno.tabs.expectActiveAt('Juno', 0)
  await chat.expectOwner('sent from the second tab')
  await chat.expectJuno('You said: sent from the second tab')

  await juno.tabs.selectAt('Juno', 1)
  await junoNav(juno).click()
  await juno.tabs.expectActiveAt('Juno', 1)
  await expect(juno.tabs.tab('Juno')).toHaveCount(2)
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
  // Beside the topic: 440px, and the topic keeps its header.
  await expect.poll(() => juno.win.locator('aside[data-juno-panel]').evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
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
  // Covering: the page's width less the 8px inset each side, and the page keeps its full width under it.
  const width = (locator: typeof page) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  await expect.poll(async () => (await width(panel)) === (await width(page)) - 16).toBe(true)
  expect(await width(page)).toBeLessThan(856)
  await setWindowWidth(juno, 1600)
  await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
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

/** Drags the mouse across `words` in a message, as the owner highlights them. */
async function highlight(juno: Juno, row: Locator, words: string): Promise<void> {
  const at = await row.evaluate((el, words) => {
    const walker = document.createTreeWalker(el.querySelector('[data-msg-text]')!, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(words)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const first = range.getBoundingClientRect()
      range.setStart(node, i + words.length - 1)
      range.setEnd(node, i + words.length)
      const last = range.getBoundingClientRect()
      return { from: first.left + 1, to: last.right - 1, y: first.top + first.height / 2 }
    }
    throw new Error(`"${words}" is not in the message`)
  }, words)
  await juno.win.mouse.move(at.from, at.y)
  await juno.win.mouse.down()
  await juno.win.mouse.move(at.to, at.y, { steps: 6 })
  await juno.win.mouse.up()
  await expect.poll(() => juno.win.evaluate(() => document.getSelection()?.toString())).toBe(words)
}

test('Ask Juno on highlighted text opens the panel with the selection quoted, and Juno gets the words and where they are from', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(0)

  const root = juno.topic.message(POSTGRES)
  await highlight(juno, root, 'logical replication')
  // The selection's toolbar: Quote, and Ask Juno with its shortcut.
  const toolbar = juno.win.getByRole('toolbar', { name: 'Selection' })
  await expect(toolbar.getByRole('button', { name: 'Quote' })).toBeVisible()
  const ask = toolbar.getByRole('button', { name: 'Ask Juno' })
  await expect(ask).toHaveAttribute('data-tooltip', 'Ask Juno about the selection')
  await expect(ask).toHaveAttribute('data-tooltip-keys', '⌘J')
  await ask.click()

  // The panel opens with the selection quoted and its field focused; the highlight and the toolbar go.
  const panel = JunoChatPane.panel(juno.win)
  const chip = panel.root.locator('[data-panel-selection]')
  await expect(chip).toHaveText('Leo: “logical replication”')
  await expect(chip).toHaveAttribute('data-tooltip', 'Leo: logical replication')
  await expect(panel.composer).toBeFocused()
  await expect(toolbar).toHaveCount(0)
  expect(await juno.win.evaluate(() => document.getSelection()?.toString())).toBe('')

  await juno.win.keyboard.type('is this the plan?')
  await juno.win.keyboard.press('Enter')
  await panel.expectJuno('You said: is this the plan?')
  // Juno gets the words, the topic they are in, and the message they come from: its sender and ts.
  const ts = await root.getAttribute('data-message-row')
  const input = model.inputs().at(-1)!
  expect(input).toMatch(/^<message id="n1"><about topic="t:[^"]+" title="Draft plan is in the doc[^"]*" channel="#eng" [^>]*>/)
  expect(input).toContain(`<selection from="Leo" ts="${ts}">logical replication</selection></about>is this the plan?</message>`)
  await expect(chip).toHaveCount(0)
})

test('⌘J with text selected across messages asks about it without closing the panel, and Backspace on the chip removes it', async ({ juno, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()

  // From Dev's reply into the owner's: the open panel's chip follows the selection.
  const from = juno.topic.message('4 minutes is fine')
  const to = juno.topic.message("Good. What's the rollback")
  await from.evaluate((start, end) => {
    const text = (row: Element) => document.createTreeWalker(row.querySelector('[data-msg-text]')!, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange()
    range.setStart(text(start), 0)
    range.setEnd(text(end!), 'Good'.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }, await to.elementHandle())
  const chip = panel.root.locator('[data-panel-selection]')
  await expect(chip).toHaveText('2 messages: “4 minutes is fine for us…”')

  // ⌘J with the selection asks about it: the highlight clears, the panel stays, its field has focus.
  await juno.tabs.menu('juno')
  await expect.poll(() => juno.win.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(panel.composer).toBeFocused()
  await expect(chip).toHaveText('2 messages: “4 minutes is fine for us…”')

  await chip.focus()
  await juno.win.keyboard.press('Backspace')
  await expect(chip).toHaveCount(0)
  await expect(panel.composer).toBeFocused()
  await panel.send('and now?')
  await panel.expectJuno('You said: and now?')
  expect(model.inputs().at(-1)).not.toContain('<selection')
})

test('the topic chip in the panel composer names the topic Juno sees', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const line = juno.win.locator('[data-panel-sees]')
  await expect(line).toHaveText(/^eng · Draft plan is in the doc/)
  await expect(line).toHaveAttribute('title', /^Juno sees eng · Draft plan is in the doc/)
})

test('the panel is open in one tab and closed in another, and each keeps its state across a tab switch', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  const panel = juno.win.locator('aside[data-juno-panel]')
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  await expect(panel).toHaveCount(1)
  // A second topic in a new tab: the panel is closed there.
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.expectTitle(RINA)
  await expect(panel).toHaveCount(0)
  // Back to the first tab: still open. And to the second: still closed.
  await juno.tabs.select(POSTGRES)
  await expect(panel).toHaveCount(1)
  await juno.tabs.select('Rina finished the onsite')
  await expect(panel).toHaveCount(0)
})

test('the panel opens at the newest message on its first frame, with no jump, when its chat has history to scroll', async ({ juno }) => {
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
  await expect(juno.win.locator('aside[data-juno-panel]')).toHaveCount(0)

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

test('an answer that arrives while the chat is on screen in the focused window is read, with no "new" divider', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  expect(await juno.win.evaluate(() => document.hasFocus())).toBe(true)
  // Records any "new" divider that shows in a Juno chat, even for a frame.
  await juno.win.evaluate(() => {
    const seen = window as unknown as { dividerSeen: boolean }
    seen.dividerSeen = false
    new MutationObserver(() => {
      if (document.querySelector('[data-juno-chat] [data-new-divider]') !== null) seen.dividerSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  const dividerSeen = () => juno.win.evaluate(() => (window as unknown as { dividerSeen: boolean }).dividerSeen)
  const count = juno.win.getByTitle(/unread from Juno$/)

  await junoNav(juno).click()
  const tab = JunoChatPane.tab(juno.win)
  await tab.send('what is on today?')
  await tab.expectJuno('You said: what is on today?')
  await expect(count).toHaveCount(0)
  expect(await dividerSeen()).toBe(false)

  // The panel beside a topic too.
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.send('and tomorrow?')
  await panel.expectJuno('You said: and tomorrow?')
  await expect(count).toHaveCount(0)

  // Read, so the chat opens again at the bottom with no divider.
  await junoNav(juno).click()
  await tab.expectJuno('You said: and tomorrow?')
  expect(await dividerSeen()).toBe(false)
})
