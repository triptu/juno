import { expect, test, type Page } from '@playwright/test'
import { measure, textEmoji } from './buttonInk'
import { openState, type Route, type Theme } from './support'

/**
 * The message menu (SPEC 7, "Message menu"; primitives.md, ContextMenu):
 * 12px labels on 22px rows with 14px icons; a 2 × 6 grid of 14px emoji in
 * 24px cells, spread across the menu with its first and last emoji in line
 * with the rows' icons; emoji drawn opaque. It opens downward from the
 * pointer, to its left near the right edge; More reactions grows the picker
 * from the corner of the menu that stays put.
 */

const open = (page: Page, id: string, theme: Theme = 'light') =>
  openState(page, { component: 'MessageMenu', id, route: `MessageMenu/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

const menu = (page: Page) => page.locator('[data-fixture-frame] [data-context-menu]')

for (const theme of ['light', 'dark'] as const) {
  test(`the rows and the grid have the menu's sizes, and the grid lines up with the rows' icons (${theme})`, async ({ page }) => {
    await open(page, 'look/bare', theme)
    const sizes = await menu(page).evaluate((root) => {
      const box = root.getBoundingClientRect()
      const rows = [...root.querySelectorAll('[role="menuitem"]')].map((row) => row.getBoundingClientRect())
      const icon = root.querySelector('[role="menuitem"] svg')!.getBoundingClientRect()
      const cells = [...root.querySelectorAll('[data-menu-cell]')].map((cell) => cell.getBoundingClientRect())
      const glyph = root.querySelector('[data-grid-reaction] span')!
      return {
        width: box.width,
        rows: rows.map((row) => row.height),
        icon: { width: icon.width, left: icon.left - box.left },
        font: getComputedStyle(root.querySelector('[role="menuitem"]')!).fontSize,
        cells: cells.map((cell) => ({ left: cell.left - box.left, top: cell.top - box.top, width: cell.width, height: cell.height })),
        emoji: { size: getComputedStyle(glyph).fontSize, colour: getComputedStyle(glyph).color },
      }
    })
    expect(sizes.font).toBe('12px')
    expect(new Set(sizes.rows)).toEqual(new Set([22]))
    expect(sizes.icon.width).toBe(14)
    expect(sizes.emoji.size).toBe('14px')
    // Opaque: Chromium draws a colour emoji with its text colour's alpha.
    expect(sizes.emoji.colour).toMatch(/^rgb\(/)
    // About 190px wide with these rows.
    expect(sizes.width).toBeGreaterThanOrEqual(180)
    expect(sizes.width).toBeLessThanOrEqual(200)
    // Twelve 24px cells, six a row, at least 5px apart, the two rows 6px apart.
    expect(sizes.cells).toHaveLength(12)
    expect(sizes.cells.every((cell) => cell.width === 24 && cell.height === 24)).toBe(true)
    const first = sizes.cells.slice(0, 6)
    for (let i = 1; i < 6; i++) expect(first[i]!.left - (first[i - 1]!.left + 24)).toBeGreaterThanOrEqual(5)
    expect(sizes.cells[6]!.top - (sizes.cells[0]!.top + 24)).toBe(6)

    // What is painted: each emoji and More reactions centred in its cell, the first emoji's ink in line with the
    // rows' icons, and the last cell's ink as far from the menu's right edge as the first's is from its left.
    const grid = await measure(page, menu(page).locator('[data-reaction-grid]'))
    const gridBox = (await menu(page).locator('[data-reaction-grid]').boundingBox())!
    const menuBox = (await menu(page).boundingBox())!
    for (const item of grid.items.filter((each) => !textEmoji(each.name))) {
      expect(Math.abs(item.ink.x - item.button.x), `${item.name}: ${JSON.stringify(item)}`).toBeLessThanOrEqual(0.5)
      expect(Math.abs(item.ink.y - item.button.y), `${item.name}: ${JSON.stringify(item)}`).toBeLessThanOrEqual(0.5)
    }
    if (process.platform === 'darwin') {
      const firstInk = gridBox.x + grid.items[0]!.edges.left
      const lastInk = gridBox.x + grid.items[5]!.edges.right
      const iconInk = menuBox.x + sizes.icon.left
      expect(Math.abs(firstInk - iconInk)).toBeLessThanOrEqual(1)
      expect(Math.abs(firstInk - menuBox.x - (menuBox.x + menuBox.width - lastInk))).toBeLessThanOrEqual(1)
    }
  })
}

const FRAME = { width: 900, height: 640 }
const EDGE = 6

/** The menu's box from the frame's top left. */
const boxOf = async (page: Page) => {
  const frame = (await page.locator('[data-fixture-frame]').boundingBox())!
  const box = (await menu(page).boundingBox())!
  return { left: box.x - frame.x, top: box.y - frame.y, right: box.x - frame.x + box.width, bottom: box.y - frame.y + box.height, width: box.width, height: box.height }
}

test('the menu opens downward from the pointer, to its left near the right edge, and up only as far as it must near the bottom', async ({ page }) => {
  await open(page, 'placement/top-left')
  expect(await boxOf(page)).toMatchObject({ left: 41, top: 41 })
  await open(page, 'placement/top-right')
  expect(await boxOf(page)).toMatchObject({ right: FRAME.width - 40, top: 41 })
  await open(page, 'placement/bottom-left')
  const bottom = await boxOf(page)
  expect(bottom).toMatchObject({ left: 41, bottom: FRAME.height - EDGE })
  await open(page, 'placement/bottom-right')
  expect(await boxOf(page)).toMatchObject({ right: FRAME.width - 40, bottom: FRAME.height - EDGE })
})

for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
  test(`More reactions near the ${corner} grows the picker from the menu's ${corner} corner, which stays put`, async ({ page }) => {
    await open(page, `placement/${corner}`)
    const before = await boxOf(page)
    await open(page, `more-reactions/${corner}`)
    const after = await boxOf(page)
    expect([after.width, after.height]).toEqual([314, 360])
    const [y, x] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
    expect(after[x]).toBe(before[x])
    expect(after[y]).toBe(before[y])
    expect(after.left).toBeGreaterThanOrEqual(EDGE)
    expect(after.top).toBeGreaterThanOrEqual(EDGE)
    expect(after.right).toBeLessThanOrEqual(FRAME.width - EDGE)
    expect(after.bottom).toBeLessThanOrEqual(FRAME.height - EDGE)
  })
}

test('in a window too short for the picker above or below the menu, the picker is held inside it', async ({ page }) => {
  await open(page, 'more-reactions/short-window')
  const box = await boxOf(page)
  expect(box.top).toBe(EDGE)
  expect(box.left).toBe(41)
})

for (const theme of ['light', 'dark'] as const) {
  test(`a row's key sits at its end, as far in as the icon on the other side, in the icons' colour; highlighted, in the highlight's (${theme})`, async ({ page }) => {
    const read = () =>
      menu(page).evaluate((root) =>
        Object.fromEntries(
          [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((row) => {
            const box = row.getBoundingClientRect()
            const [icon, label, key] = [...row.children] as HTMLElement[]
            const svg = icon!.querySelector('svg')!.getBoundingClientRect()
            const keyBox = key?.getBoundingClientRect()
            return [
              row.dataset['menuItem'],
              {
                iconInset: svg.left - box.left,
                keyInset: keyBox === undefined ? undefined : box.right - keyBox.right,
                gap: keyBox === undefined ? undefined : keyBox.left - label!.getBoundingClientRect().right,
                key: key?.textContent,
                keyColour: key === undefined ? undefined : getComputedStyle(key).color,
                keyFont: key === undefined ? undefined : getComputedStyle(key).fontSize,
                iconColour: getComputedStyle(icon!).color,
                labelColour: getComputedStyle(row).color,
              },
            ]
          }),
        ),
      )
    await open(page, 'look/own-main', theme)
    const rows = await read()
    expect([rows['reply']!.key, rows['edit']!.key, rows['delete']!.key]).toEqual(['T', 'E', '⌫'])
    expect(rows['quote']!.key).toBeUndefined()
    for (const id of ['reply', 'edit', 'delete']) {
      const row = rows[id]!
      expect(row.keyInset, id).toBe(row.iconInset)
      expect(row.keyInset, id).toBe(9)
      expect(row.gap!, id).toBeGreaterThanOrEqual(20)
      expect(row.keyColour, id).toBe(row.iconColour)
      expect(row.keyFont, id).toBe('12px')
    }
    // The rows with keys need no more room than the widest label: the menu keeps its width.
    const width = (await menu(page).boundingBox())!.width
    expect(width).toBeLessThanOrEqual(200)

    await open(page, 'interaction/hover-shortcut', theme)
    await menu(page).locator('[data-menu-item="edit"]').hover()
    await expect(menu(page).locator('[data-menu-item="edit"]')).toBeFocused()
    const hovered = await read()
    expect(hovered['edit']!.keyColour).toBe(hovered['edit']!.labelColour)
    expect(hovered['delete']!.keyColour).toBe(hovered['delete']!.iconColour)
    expect(hovered['delete']!.keyColour).not.toBe(hovered['edit']!.keyColour)
  })
}
