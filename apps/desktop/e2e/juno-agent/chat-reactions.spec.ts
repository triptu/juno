// Reactions in the Juno chat (SPEC 13.1) in the browser: the quick reactions
// and the emoji picker a topic's messages use, badges that show whole at the
// panel's narrowest and in the wide Juno tab, in light and dark, and ↑ through
// a draft's lines. An answer keeps its quote even right under the message it
// answers. The keyboard's way to a bubble's menu is in the DOM lane
// (`dom/juno-agent/chat-reactions.test.ts`).
import type { Locator } from '@playwright/test'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

async function setWindowSize(juno: Juno, width: number, height: number): Promise<void> {
  await juno.setWindowSize(width, height)
}

/**
 * What cuts a reaction badge: every ancestor that clips its paint (paint
 * containment, a scroller) and whose clip edge, with its
 * `overflow-clip-margin`, the badge crosses; and the header's islands,
 * which float over the list's top. Empty when the badge shows whole.
 */
async function cutsOf(badge: Locator): Promise<ReadonlyArray<string>> {
  return badge.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const cuts: string[] = []
    const outside = (r: { top: number; left: number; bottom: number; right: number }, m: number) =>
      box.top < r.top - m - 0.5 || box.left < r.left - m - 0.5 || box.bottom > r.bottom + m + 0.5 || box.right > r.right + m + 0.5
    for (let node = el.parentElement; node !== null && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      const scrolls = style.overflowX !== 'visible' || style.overflowY !== 'visible'
      const paint = /paint|content|strict/.test(style.contain) || style.contentVisibility === 'auto'
      if (!scrolls && !paint) continue
      const margin = scrolls ? 0 : Number.parseFloat(style.overflowClipMargin) || 0
      const r = node.getBoundingClientRect()
      if (outside(r, margin)) cuts.push(`${node.tagName.toLowerCase()}${[...node.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('')}: badge ${[box.left, box.top, box.right, box.bottom].map(Math.round).join(',')}, clip ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')} + ${margin}`)
    }
    for (const island of el.closest('[data-juno-chat]')?.querySelectorAll('[data-juno-header] [data-island]') ?? []) {
      const r = island.getBoundingClientRect()
      if (r.width > 0 && box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top) cuts.push(`under the header's ${island.getAttribute('data-island')} island`)
    }
    return cuts
  })
}

/** Every badge in the list's visible area shows whole where it sits; returns which were on screen. */
async function expectBadgesWhole(chat: JunoChatPane, count: number): Promise<ReadonlyArray<string>> {
  const badges = chat.root.locator('[data-reactions]')
  await expect(badges).toHaveCount(count)
  const scroller = (await chat.root.locator('[data-scroll]').boundingBox())!
  const seen: string[] = []
  for (const badge of await badges.all()) {
    // On screen by more than a pixel: a badge past the fold is scrolled away, not cut.
    const box = await badge.boundingBox()
    if (box === null || box.y + box.height <= scroller.y + 1 || box.y >= scroller.y + scroller.height - 1) continue
    const name = (await badge.getAttribute('data-reactions')) ?? ''
    seen.push(name)
    expect.soft(await cutsOf(badge), name).toEqual([])
  }
  expect(seen.length).toBeGreaterThan(0)
  return seen
}

/**
 * Scrolls the list to an end with the mouse wheel, as a person does. A scroll set from a script is not the user's, so
 * the list keeps holding its bottom and a commit puts it back there (docs/development.md, "Hunting a flaky test").
 */
async function scrollTo(chat: JunoChatPane, where: 'top' | 'bottom'): Promise<void> {
  const scroller = chat.root.locator('[data-scroll]')
  const box = (await scroller.boundingBox())!
  const page = chat.root.page()
  const atEnd = () => scroller.evaluate((el, at) => (at === 'top' ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop) <= 1, where)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect
    .poll(async () => {
      if (await atEnd()) return true
      // A wheel's scroll animates on macOS: wait for it to end, or it carries on past a row revealed after it.
      await scroller.evaluate((el) => { (el as HTMLElement & { ended?: Promise<void> }).ended = new Promise((done) => el.addEventListener('scrollend', () => done(), { once: true })) })
      await page.mouse.wheel(0, where === 'top' ? -4000 : 4000)
      await scroller.evaluate((el) => Promise.race([(el as HTMLElement & { ended?: Promise<void> }).ended, new Promise((done) => setTimeout(done, 2000))]))
      return atEnd()
    })
    .toBe(true)
}

/** Puts a bubble's row at the top of the list, under the header, as revealing a row does (`scrollIntoView`, the list's `scroll-padding-top`). */
async function toTop(chat: JunoChatPane, bubble: string): Promise<void> {
  await chat.junoBubble(bubble).evaluate((row) => row.scrollIntoView({ block: 'start', behavior: 'instant' }))
}

async function shoot(chat: JunoChatPane, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`)
  await chat.root.screenshot({ path, animations: 'disabled' })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

/** Opens the panel beside the topic and drags its edge right as far as it goes: the panel at its narrowest. */
async function narrowestPanel(juno: Juno): Promise<JunoChatPane> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()
  const at = (await juno.win.locator('[data-juno-panel-edge]').boundingBox())!
  await juno.win.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await juno.win.mouse.down()
  await juno.win.mouse.move(at.x + 300, at.y + at.height / 2, { steps: 5 })
  await juno.win.mouse.up()
  await expectPanelWidth(juno, 360)
  return panel
}

async function expectPanelWidth(juno: Juno, width: number): Promise<void> {
  await expect.poll(() => juno.win.locator('aside[data-juno-panel]').evaluate((el) => el.getBoundingClientRect().width)).toBe(width)
}

/**
 * The places a badge must show whole: the first reacted bubble and the wide
 * one each revealed right under the header, and the last bubble at the
 * bottom. Each is shot before it is checked.
 */
async function expectWholeEverywhere(chat: JunoChatPane, name: string): Promise<void> {
  // Release a newly mounted chat's bottom hold with user input before revealing individual rows.
  await scrollTo(chat, 'top')
  await toTop(chat, 'Answering quote me first')
  await shoot(chat, `${name}-top`)
  expect(await expectBadgesWhole(chat, 4)).toContain('owner:🎉')
  await toTop(chat, 'Here is the long one')
  await shoot(chat, `${name}-top-wide`)
  expect(await expectBadgesWhole(chat, 4)).toContain('owner:✅')
  await scrollTo(chat, 'bottom')
  await shoot(chat, `${name}-bottom`)
  expect(await expectBadgesWhole(chat, 4)).toContain('owner:👍')
}

test('a Juno bubble takes a quick reaction and any emoji from the picker, its badge shows whole at every width and in both themes, a custom emoji shows as an image, and ↑ walks a draft\'s lines before the bubbles', async ({ juno, model }) => {
  await ready(juno)
  await setWindowSize(juno, 1400, 640)
  const panel = await narrowestPanel(juno)

  // An answer right under the message it answers still quotes it: you may have sent several.
  await panel.send('quote me first')
  await panel.expectJuno('Answering quote me first')
  await expect(panel.root.locator('[data-chat-juno]').filter({ hasText: 'Answering quote me first' }).locator('[data-quote="owner"]')).toContainText('quote me first')

  // A wide bubble: its badge sits at the right, under the panel's Open in tab and Close when the row is at the top.
  await panel.send('the long one')
  await panel.expectJuno('Here is the long one')
  await panel.react('Here is the long one', '✅')
  await expect(panel.junoBubble('Here is the long one').getByLabel('Reacted ✅')).toBeVisible()

  // Enough for the list to scroll, so a bubble can sit right under the header.
  for (const n of [2, 3, 4, 5, 6]) {
    await panel.send(`note ${n}`)
    await panel.expectJuno(`You said: note ${n}`)
  }

  // A quick reaction, from the grid of the menu a topic's messages use: the badge shows at once.
  await panel.react('You said: note 6', '👍')
  await expect(panel.reactions).toHaveCount(0)
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toBeVisible()

  // Any emoji: More reactions turns the menu into the emoji picker; search, then pick. Juno hears it.
  await panel.reactWithPicker('You said: note 5', 'rocket', 'rocket')
  await expect(panel.root.locator('[data-emoji-picker]')).toHaveCount(0)
  await expect(panel.junoBubble('You said: note 5').getByLabel('Reacted 🚀')).toBeVisible()
  await expect.poll(() => model.inputs().some((input) => input.startsWith('<reaction') && input.includes('emoji="🚀"'))).toBe(true)

  // The first bubble in the list, picked from the top of the list.
  await scrollTo(panel, 'top')
  await panel.reactWithPicker('Answering quote me first', 'tada', 'tada')
  await expect(panel.junoBubble('Answering quote me first').getByLabel('Reacted 🎉')).toBeVisible()
  await expectWholeEverywhere(panel, 'panel-360-light')

  // Picking the same quick reaction again removes it.
  await panel.react('You said: note 6', '👍')
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toHaveCount(0)
  await panel.react('You said: note 6', '👍')
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toBeVisible()

  // Dark: Settings takes the tab, so the topic comes back with the panel closed; it opens at the width it was left at.
  await juno.setTheme('Dark')
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  await expect(panel.composer).toBeFocused()
  await expectPanelWidth(juno, 360)
  // The badges in dark are checked in the wide tab below: the panel's clips are the same in either theme.

  // The wide Juno tab.
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await juno.tabs.expectActive('Juno')
  await expectWholeEverywhere(JunoChatPane.tab(juno.win), 'tab-wide-dark')

  // A workspace's custom emoji from the picker: stored by name, drawn as an image, and Juno hears its name.
  const tab = JunoChatPane.tab(juno.win)
  await tab.reactWithPicker('You said: note 6', 'hello_juno', 'juno_wave')
  await expect(tab.junoBubble('You said: note 6').getByLabel('Reacted juno_wave').locator('img')).toBeVisible()
  await expect.poll(() => model.inputs().some((input) => input.startsWith('<reaction') && input.includes('emoji="juno_wave"'))).toBe(true)

  // A two-line draft with the caret on its second line: ↑ moves the caret a line, ↑ again reaches the newest
  // bubble, ↓ comes back to the draft. Which line the caret is on is the field's layout.
  const newest = tab.junoBubble('You said: note 6').locator('[data-chat-row]')
  await tab.composer.fill('first line\nsecond line')
  await tab.composer.press('ArrowUp')
  await expect(tab.composer).toBeFocused()
  await tab.composer.press('ArrowUp')
  await expect(newest).toBeFocused()
  await juno.win.keyboard.press('ArrowDown')
  await expect(tab.composer).toBeFocused()
  await expect(tab.composer).toHaveValue('first line\nsecond line')
})
