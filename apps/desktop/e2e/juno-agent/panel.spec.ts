// The Juno panel's layout in the browser: its width beside a topic and when it covers one, the
// emoji list's Esc (an emoji pick inserts with execCommand), its first frame and its surfaces in dark
// mode. Opening, closing, state per tab, selections and Ask Juno are in the DOM lane
// (`dom/juno-agent/panel.test.ts`).
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const panelOf = (juno: Juno) => juno.win.locator('aside[data-juno-panel]')

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.setWindowSize(width)
}

async function widthAndEmoji(juno: Juno, model: { readonly inputs: () => ReadonlyArray<string> }): Promise<void> {
  await setWindowWidth(juno, 1400)
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
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
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)
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

test('the panel is 440px beside a topic and covers it when narrow, keeping its draft and focus; an emoji list closes before it; and it opens at the newest message on its first frame and has no light surface in dark mode', async ({ juno, model }) => {
  await ready(juno)
  await test.step('440px beside the topic, and Esc closes an emoji list before the panel', () => widthAndEmoji(juno, model))
  await test.step('the panel covers the topic when the topic would keep less than 480px, keeping its draft and focus', () => resizePanel(juno))
  await juno.tabs.menu('juno')
  await expect(panelOf(juno)).toHaveCount(0)
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
