// The Juno chat and panel in the browser, as one journey from a synced start with the agent ready: an answer
// leaves the owner's bubble where it painted; an answer on screen in the focused window is read; a question
// written on Home goes to the chat with its picks and its field where Home's was; the panel's width beside a
// topic and when it covers one, the emoji list's Esc (an emoji pick inserts with execCommand), its first frame and
// its surfaces in dark mode; the open panel following a selection; and the panel at its bottom keeping a new
// answer in view. Opening, closing, state per tab and Ask Juno are in the DOM lane
// (`dom/juno-agent/panel.test.ts`), and the rest of the Juno tab too (`dom/juno-agent/chat.test.ts`).
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Locator } from '@playwright/test'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expectRestSurvivesGrowth, expectScrollEscapesGrowth } from '../scrollGrowthProbe'
import { expectStableAnchor } from '../shiftProbe'
import { frames, longerThanView, wheelDownAtEnd } from '../stickBottomLists'
import { watchArrival, type Frame } from '../stickBottomProbe'
import { answer, expect, JunoChatPane, test as chatTest } from './chat'

/** The question whose answer waits for the gate, so it arrives while the owner rests at the panel's end. */
const HELD = 'a held question at the bottom of the panel'

/** The chat test with a model that holds its answer to HELD until the gate opens. */
const test = chatTest.extend<{ readonly gate: { readonly wait: Promise<void>; readonly open: () => void } }>({
  // oxlint-disable-next-line no-empty-pattern
  gate: async ({}, use) => {
    let open = () => {}
    const wait = new Promise<void>((resolve) => (open = resolve))
    await use({ wait, open })
    open()
  },
  model: async ({ gate }, use) => {
    const model = await startFakeOpenRouter({
      answer: async (request) => {
        if (request.input.includes(HELD)) await gate.wait
        return answer(request)
      },
    })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 180_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const panelOf = (juno: Juno) => juno.win.locator('aside[data-juno-panel]')
const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

test('the Juno chat and panel: answers move nothing and are read on screen, a Home question keeps its picks and field, the panel\'s widths, first frame and dark surfaces, a selection it follows, and a new answer at its bottom', async ({ juno, model, gate }) => {
  await ready(juno)
  // First, while the chat is empty: the probe follows the first owner bubble on screen.
  await test.step('a Juno response leaves the owner bubble where it first painted', async () => {
    await junoNav(juno).click()
    const chat = JunoChatPane.tab(juno.win)
    await chat.composer.fill('Check the layout of this reply')
    await expectStableAnchor(juno.win, '[data-chat-owner]', async () => {
      await chat.composer.press('Enter')
      await chat.expectJuno('You said: Check the layout of this reply')
    })
  })
  await test.step('an answer that arrives while the chat is on screen in the focused window is read, with no "new" divider', () => readOnScreen(juno))
  await test.step('a question written on Home goes to the Juno chat with its picks, the field where Home’s was, and Back returns to Home; the Juno tab takes @ and # picks too', () => homeQuestion(juno, model))
  await test.step('440px beside the topic, and Esc closes an emoji list before the panel', () => widthAndEmoji(juno, model))
  await test.step('the panel covers the topic when the topic would keep less than 480px, keeping its draft and focus', () => resizePanel(juno))
  await test.step('the panel opens at the newest message on its first frame', () => firstFrame(juno))
  await test.step('in dark mode no light surface shows in the panel', () => darkSurfaces(juno))
  await test.step('the open panel follows later selections: ⌘J asks about them, Backspace on the chip removes it, and a drag while the field has focus gives a new chip', () => followSelection(juno, model))
  await test.step('the panel at the bottom keeps a new answer fully in view', () => answerAtBottom(juno, gate))
})

async function readOnScreen(juno: Juno): Promise<void> {
  await juno.setWindowSize(1400)
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
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)

  // Read, so the chat opens again at the bottom with no divider.
  await junoNav(juno).click()
  await tab.expectJuno('You said: and tomorrow?')
  expect(await dividerSeen()).toBe(false)
}

async function homeQuestion(juno: Juno, model: { readonly inputs: () => ReadonlyArray<string> }): Promise<void> {
  const { write, tabs } = juno
  await juno.home.open()
  await write.expectDestination('Juno')
  await write.composer.pressSequentially('What did @Ma')
  await expect(write.suggestion('Maya')).toBeVisible()
  await write.composer.press('Enter')
  await write.composer.pressSequentially('say today?')
  const before = await write.field.boundingBox()
  await write.send()
  await tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await chat.expectOwner('What did @Maya say today?')
  await chat.expectJuno('You said: What did @Maya say today?')
  // After the answer nothing on screen moves.
  await juno.expectAtRest()
  // The message's id counts the chat's messages so far, which the steps before sent.
  expect(model.inputs().at(-1)).toMatch(/^<message id="n\d+"><person id="U0MAYA" name="Maya"\/>What did @Maya say today\?<\/message>$/)
  const after = await chat.root.locator('[data-composer-field]').boundingBox()
  const edges = (box: typeof before) => ({ x: box?.x, width: box?.width, bottom: (box?.y ?? 0) + (box?.height ?? 0) })
  expect(edges(after)).toEqual(edges(before))
  await juno.nav.back()
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')

  // The Juno tab's composer takes the same picks (they insert with execCommand, which happy-dom lacks).
  await junoNav(juno).click()
  // @ and # use the topic composer's suggestions; Juno reads each pick's id, and the bubble shows plain names.
  await chat.composer.pressSequentially('Ask @Ma')
  await expect(chat.suggestion('Maya')).toBeVisible()
  await expect(chat.composer).toHaveAttribute('aria-activedescendant', /.+/)
  await chat.composer.press('Enter')
  await expect(chat.suggestions).toHaveCount(0)
  await expect(chat.composerChips).toHaveText(['@Maya'])
  await chat.composer.pressSequentially('about #en')
  await expect(chat.suggestion('eng')).toBeVisible()
  await chat.composer.press('Tab')
  await expect(chat.composer).toHaveValue('Ask @Maya about #eng ')
  await expect(chat.composerChips).toHaveText(['@Maya', '#eng'])
  await expect(chat.composerChips.last()).toHaveAttribute('data-mark', 'channel')
  await chat.composer.press('Enter')
  await chat.expectJuno('You said: Ask @Maya about #eng')
  expect(model.inputs().at(-1)).toMatch(/^<message id="n\d+"><person id="U0MAYA" name="Maya"\/><channel id="C0ENG" name="#eng"\/>Ask @Maya about #eng<\/message>$/)
  const picked = chat.ownerBubble('Ask @Maya about #eng')
  await expect(picked.locator('p')).toHaveText('Ask @Maya about #eng')
  await expect(picked.locator('a, [data-person], [data-channel], [data-mark]')).toHaveCount(0)
  await expect(chat.composerChips).toHaveCount(0)
}

async function widthAndEmoji(juno: Juno, model: { readonly inputs: () => ReadonlyArray<string> }): Promise<void> {
  await juno.setWindowSize(1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  // Beside the topic: 440px, and the topic keeps its header.
  await expect.poll(() => panelOf(juno).evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
  await expect(juno.win.locator('[data-topic-header]')).toBeVisible()

  // Enter takes an emoji suggestion without sending, and Esc closes the list, not the panel.
  const sent = model.inputs().length
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
  expect(model.inputs()).toHaveLength(sent)
  await panel.composer.fill('')
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)
}

async function resizePanel(juno: Juno): Promise<void> {
  await juno.setWindowSize(1100)
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
    await juno.setWindowSize(next)
    await expect.poll(() => juno.win.evaluate(() => innerWidth)).toBeLessThanOrEqual(next)
    await expect(composer).toHaveValue('Half written question')
    await expect(composer).toBeFocused()
  }
  await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().width)).toBe(440)
  await composer.fill('')
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)
}

async function firstFrame(juno: Juno): Promise<void> {
  await juno.setWindowSize(1400)
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
  const painted = await juno.win.evaluate(() => (window as unknown as { panelFrames: Array<{ atEnd: boolean; lastInView: boolean }> }).panelFrames)
  // The scroller has more than a screenful, and every frame from the first shows its end.
  expect(await panel.root.locator('[data-scroll]').evaluate((el) => el.scrollHeight > el.clientHeight * 1.5)).toBe(true)
  expect(painted).toEqual(Array.from({ length: 10 }, () => ({ atEnd: true, lastInView: true })))
}

async function darkSurfaces(juno: Juno): Promise<void> {
  // Settings takes the tab, so the topic comes back with the panel closed.
  await juno.setTheme('Dark')
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  await expect(JunoChatPane.panel(juno.win).composer).toBeFocused()
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
}

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

/** The panel is open beside the Postgres thread, from the step before. */
async function followSelection(juno: Juno, model: { readonly inputs: () => ReadonlyArray<string> }): Promise<void> {
  await juno.topic.expectTitle(POSTGRES)
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

  // A drag over a message highlights it while the panel's field has focus, and the chip takes it.
  // The press takes focus from the field; resting a few frames before moving, as a person does, must not lose the drag's start.
  // The message's first words, at the start of the line: the hover toolbar sits at its end.
  await expect(panel.composer).toBeFocused()
  await highlight(juno, juno.topic.message(POSTGRES), 'Draft plan is in the doc')
  await expect(chip).toHaveText('Leo: “Draft plan is in the doc”')
  await chip.focus()
  await juno.win.keyboard.press('Backspace')
  await expect(chip).toHaveCount(0)
}

/** Every frame from the first that draws the row shows it whole, with the list at its end. */
function expectHeldAtEnd(seen: Frame[]): void {
  expect(seen.length, 'the row is drawn').toBeGreaterThan(1)
  expect(seen.filter((frame) => !frame.inView || frame.distance > 1)).toEqual([])
}

/** The panel is open, with more than a screenful of bubbles from the steps before. */
async function answerAtBottom(juno: Juno, gate: { readonly open: () => void }): Promise<void> {
  const { win } = juno
  const panel = JunoChatPane.panel(win)
  const scroller = win.locator('aside[data-juno-panel] [data-scroll]')
  await frames(win, 5)
  expect(await longerThanView(scroller)).toBe(true)

  // Juno is still answering while the owner, at the end, turns the wheel down.
  await panel.send(HELD)
  await panel.expectOwner(HELD)
  await frames(win, 5)
  await wheelDownAtEnd(win, scroller)
  const watched = await watchArrival(win, 'aside[data-juno-panel] [data-scroll]', '[data-chat-juno]', `You said: ${HELD}`)
  gate.open()
  await panel.expectJuno(`You said: ${HELD}`)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await expectRestSurvivesGrowth(scroller, '[data-chat-juno]')
  await expectScrollEscapesGrowth(win, scroller, scroller.locator('[data-chat-juno]').last())
}
