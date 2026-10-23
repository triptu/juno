import { expect, test, type Locator, type Page } from '@playwright/test'
import { openState, type Route, type Theme } from './support'

/**
 * A message's menu button (inventory 6.5): hidden at rest, shown over the
 * end of the first line of the row under the pointer, level with that line,
 * its right edge as far in from the row's edge as the avatar is from the
 * left. Showing it moves nothing. Under the pointer it takes the control
 * hover fill; while its menu is open it stays, held, and the menu opens
 * under it.
 */

const open = (page: Page, id: string, theme: Theme) =>
  openState(page, { component: 'MessageList', id, route: `MessageList/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

const frame = (page: Page) => page.locator('[data-fixture-frame]')
const rows = (page: Page) => frame(page).locator('[data-message-row]')
const more = (row: Locator) => row.locator('[data-message-more] button')

/** The button's box, the row's, the avatar column's and the first line's, from the line boxes themselves. */
async function geometry(row: Locator) {
  return row.evaluate((element) => {
    const box = (node: Element) => node.getBoundingClientRect()
    const button = element.querySelector('[data-message-more] button')!
    const header = element.querySelector('[data-message-header]')
    const text = element.querySelector('[data-msg-text]')
    let line: DOMRect | undefined
    if (header !== null) line = box(header)
    else if (text !== null) {
      // The first line box of the first words, as tall as the text's line.
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null && line === undefined; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        line = [...range.getClientRects()].find((rect) => rect.width > 0)
      }
    }
    const lineHeight = text === null ? 0 : Number.parseFloat(getComputedStyle(text).lineHeight)
    const first = header !== null || line === undefined ? line : new DOMRect(line.x, line.y + line.height / 2 - lineHeight / 2, line.width, lineHeight)
    return {
      button: box(button).toJSON() as DOMRect,
      row: box(element).toJSON() as DOMRect,
      gutter: box(element.children[header === null ? 1 : 0]!).toJSON() as DOMRect,
      line: first?.toJSON() as DOMRect | undefined,
    }
  })
}

const boxes = (page: Page) => rows(page).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect))

for (const theme of ['light', 'dark'] as const) {
  test(`the menu button shows on hover, level with the first line and moving nothing, in ${theme}`, async ({ page }) => {
    for (const [state, index, name] of [
      ['menu-button/hover', 3, 'hovered'],
      ['menu-button/hover', 4, 'hovered-grouped'],
      ['menu-button/hover', 0, 'hovered-first'],
      ['menu-button/long-hover', 0, 'long-hovered'],
      ['menu-button/long-hover', 1, 'long-hovered-grouped'],
      ['menu-button/long-hover', 2, 'long-hovered-code'],
      ['menu-button/long-hover', 3, 'long-hovered-image'],
      ['menu-button/long-hover', 4, 'long-hovered-reactions'],
    ] as const) {
      await open(page, state, theme)
      await page.mouse.move(0, 0)
      const row = rows(page).nth(index)
      // At rest no row shows it.
      await expect(rows(page).locator('[data-message-more] button:visible')).toHaveCount(0)
      const before = await boxes(page)
      await row.locator('[data-msg-text], [data-message-header]').first().hover({ position: { x: 4, y: 4 } })
      await expect(more(row)).toBeVisible()
      await expect(rows(page).locator('[data-message-more] button:visible')).toHaveCount(1)
      expect(await boxes(page)).toEqual(before)
      const { button, row: box, gutter, line } = await geometry(row)
      // Its right inset mirrors the avatar's left inset; on a code block first, it sits inside the block's frame.
      if (name.endsWith('code')) {
        const frame = (await row.locator('pre').first().boundingBox())!
        expect(button.right).toBeLessThan(frame.x + frame.width - 1)
        expect(button.top).toBeGreaterThan(frame.y + 1)
      } else expect(Math.abs(box.right - button.right - (gutter.left - box.left))).toBeLessThanOrEqual(0.5)
      // Centred on the first line: the name and time, or the first line of words.
      if (line !== undefined) expect(Math.abs(button.top + button.height / 2 - (line.top + line.height / 2)), name).toBeLessThanOrEqual(1)
    }
  })

  test(`the menu button takes the hover fill, opens the menu under it and stays held, in ${theme}`, async ({ page }) => {
    for (const [state, index] of [
      ['menu-button/hover', 3, ''],
      ['menu-button/long-hover', 1, 'long-'],
    ] as const) {
      await open(page, state, theme)
      const row = rows(page).nth(index)
      await row.hover({ position: { x: 4, y: 4 } })
      const button = more(row)
      const rest = await button.evaluate((element) => getComputedStyle(element).backgroundColor)
      expect(rest).toBe('rgba(0, 0, 0, 0)')
      await button.hover()
      await expect.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(rest)
      await expect(button).toHaveCSS('cursor', 'default')
      await expect(button).toHaveAttribute('aria-label', 'More actions ⇧F10')
      await expect(button).toHaveAttribute('tabindex', '-1')
    }

    for (const [state, index] of [
      ['menu-button/menu-open', 1, 'menu-open'],
      ['menu-button/long-menu-open', 1, 'long-menu-open'],
    ] as const) {
      await open(page, state, theme)
      await page.mouse.move(0, 0)
      const row = rows(page).nth(index)
      const button = more(row)
      await expect(button).toBeVisible()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      const menu = frame(page).locator('[role="menu"]')
      await expect(menu).toBeVisible()
      const at = (await button.boundingBox())!
      const panel = (await menu.boundingBox())!
      expect(panel.y).toBeGreaterThanOrEqual(at.y + at.height)
      expect(panel.y - (at.y + at.height)).toBeLessThanOrEqual(2)
      // Lined up with the button: its left edge opening right, its right edge opening left.
      const aligned = Math.min(Math.abs(panel.x - at.x), Math.abs(panel.x + panel.width - (at.x + at.width)))
      expect(aligned).toBeLessThanOrEqual(1)
    }
  })
}

test('keyboard focus on a row shows its button', async ({ page }) => {
  await open(page, 'menu-button/focus', 'light')
  await page.mouse.move(0, 0)
  const row = rows(page).nth(3)
  await row.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(row).toBeFocused()
  await expect(more(row)).toBeVisible()
})
