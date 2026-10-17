// Reactions in the Juno chat (SPEC 13.1): the quick reactions and the emoji
// picker a topic's messages use, badges that show whole at the panel's
// narrowest and in the wide Juno tab, in light and dark, and no quote on an
// answer right under the message it answers.
import type { Locator } from '@playwright/test'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

async function setWindowSize(juno: Juno, width: number, height: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height })
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
      if (outside(node.getBoundingClientRect(), margin)) cuts.push(`${node.tagName.toLowerCase()}${[...node.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('')}`)
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
    const box = await badge.boundingBox()
    if (box === null || box.y + box.height <= scroller.y || box.y >= scroller.y + scroller.height) continue
    const name = (await badge.getAttribute('data-reactions')) ?? ''
    seen.push(name)
    expect(await cutsOf(badge), name).toEqual([])
  }
  expect(seen.length).toBeGreaterThan(0)
  return seen
}

async function scrollTo(chat: JunoChatPane, where: 'top' | 'bottom'): Promise<void> {
  const scroller = chat.root.locator('[data-scroll]')
  await scroller.evaluate((el, at) => el.scrollTo({ top: at === 'top' ? 0 : el.scrollHeight, behavior: 'instant' }), where)
  await expect.poll(() => scroller.evaluate((el, at) => (at === 'top' ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop) <= 1, where)).toBe(true)
}

async function shoot(chat: JunoChatPane, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`)
  await chat.root.screenshot({ path, animations: 'disabled' })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

test('a Juno bubble takes a quick reaction and any emoji from the picker, and its badge shows whole at every width and in both themes', async ({ juno, model }) => {
  await ready(juno)
  await setWindowSize(juno, 1400, 640)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()

  // The panel at its narrowest: drag its edge to the right as far as it goes.
  const edge = juno.win.locator('[data-juno-panel-edge]')
  const at = (await edge.boundingBox())!
  await juno.win.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await juno.win.mouse.down()
  await juno.win.mouse.move(at.x + 300, at.y + at.height / 2, { steps: 5 })
  await juno.win.mouse.up()
  await expect.poll(() => juno.win.locator('aside[data-juno-panel]').evaluate((el) => el.getBoundingClientRect().width)).toBe(360)

  // An answer right under the message it answers shows no quote of it.
  await panel.send('quote me first')
  await panel.expectJuno('Answering quote me first')
  await expect(panel.junoBubble('Answering quote me first').locator('[data-quote]')).toHaveCount(0)

  // Enough for the list to scroll, so the first bubble sits right under the header at the top.
  for (const n of [2, 3, 4, 5, 6]) {
    await panel.send(`note ${n}`)
    await panel.expectJuno(`You said: note ${n}`)
  }

  // A quick reaction, from the toolbar a topic's messages use: the badge shows at once.
  await panel.react('You said: note 6', '👍')
  await expect(panel.reactions).toHaveCount(0)
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toBeVisible()

  // Any emoji: More reactions opens the emoji picker; search, then pick. Juno hears it.
  await panel.reactWithPicker('You said: note 5', 'rocket', 'rocket')
  await expect(panel.root.locator('[data-emoji-picker]')).toHaveCount(0)
  await expect(panel.junoBubble('You said: note 5').getByLabel('Reacted 🚀')).toBeVisible()
  await expect.poll(() => model.inputs().some((input) => input.startsWith('<reaction') && input.includes('emoji="🚀"'))).toBe(true)

  // The first bubble in the list, right under the header once scrolled to the top.
  await scrollTo(panel, 'top')
  await panel.reactWithPicker('Answering quote me first', 'tada', 'tada')
  await expect(panel.junoBubble('Answering quote me first').getByLabel('Reacted 🎉')).toBeVisible()
  await scrollTo(panel, 'top')
  expect(await expectBadgesWhole(panel, 3)).toContain('owner:🎉')
  await shoot(panel, 'panel-360-light-top')
  await scrollTo(panel, 'bottom')
  await expectBadgesWhole(panel, 3)
  await shoot(panel, 'panel-360-light-bottom')

  // Picking the same quick reaction again removes it.
  await panel.react('You said: note 6', '👍')
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toHaveCount(0)
  await panel.react('You said: note 6', '👍')
  await expect(panel.junoBubble('You said: note 6').getByLabel('Reacted 👍')).toBeVisible()

  // Dark, then the wide Juno tab.
  // Settings takes the tab, so the topic comes back with the panel closed; it opens at the width it was left at.
  await juno.setTheme('Dark')
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  await expect(panel.composer).toBeFocused()
  await expect.poll(() => juno.win.locator('aside[data-juno-panel]').evaluate((el) => el.getBoundingClientRect().width)).toBe(360)
  await scrollTo(panel, 'top')
  expect(await expectBadgesWhole(panel, 3)).toContain('owner:🎉')
  await shoot(panel, 'panel-360-dark-top')
  await scrollTo(panel, 'bottom')
  await expectBadgesWhole(panel, 3)
  await shoot(panel, 'panel-360-dark-bottom')

  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await juno.tabs.expectActive('Juno')
  const tab = JunoChatPane.tab(juno.win)
  await scrollTo(tab, 'top')
  await expectBadgesWhole(tab, 3)
  await shoot(tab, 'tab-wide-dark-top')
})
