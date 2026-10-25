import { expect, type Page } from '@playwright/test'
import { layoutTest as test, openState, type Route, type Theme } from './support'

/**
 * The message menu (SPEC 7, "Message menu"; primitives.md, ContextMenu):
 * It opens downward from the
 * pointer, to its left near the right edge; More reactions grows the picker
 * from the corner of the menu that stays put.
 */

const open = (page: Page, id: string, theme: Theme = 'light') =>
  openState(page, { component: 'MessageMenu', id, route: `MessageMenu/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

const menu = (page: Page) => page.locator('[data-fixture-frame] [data-context-menu]')

const FRAME = { width: 900, height: 640 }
const EDGE = 6

/** The menu's box from the frame's top left. */
const boxOf = async (page: Page) => {
  const frame = (await page.locator('[data-fixture-frame]').boundingBox())!
  const box = (await menu(page).boundingBox())!
  return { left: box.x - frame.x, top: box.y - frame.y, right: box.x - frame.x + box.width, bottom: box.y - frame.y + box.height, width: box.width, height: box.height }
}

test('the menu opens downward from the pointer, to its left near the right edge, up only as far as it must near the bottom, and More reactions grows from the corner that stays put', async ({ page }) => {
  await open(page, 'placement/top-left')
  expect(await boxOf(page)).toMatchObject({ left: 41, top: 41 })
  await open(page, 'placement/top-right')
  expect(await boxOf(page)).toMatchObject({ right: FRAME.width - 40, top: 41 })
  await open(page, 'placement/bottom-left')
  const bottom = await boxOf(page)
  expect(bottom).toMatchObject({ left: 41, bottom: FRAME.height - EDGE })
  await open(page, 'placement/bottom-right')
  expect(await boxOf(page)).toMatchObject({ right: FRAME.width - 40, bottom: FRAME.height - EDGE })

  // Near each corner the picker grows from the menu's corner there, which stays put.
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
    await open(page, `placement/${corner}`)
    const before = await boxOf(page)
    await open(page, `more-reactions/${corner}`)
    const after = await boxOf(page)
    expect(after.height, corner).toBeGreaterThan(before.height)
    const [y, x] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
    expect(after[x], corner).toBe(before[x])
    expect(after[y], corner).toBe(before[y])
    expect(after.left, corner).toBeGreaterThanOrEqual(EDGE)
    expect(after.top, corner).toBeGreaterThanOrEqual(EDGE)
    expect(after.right, corner).toBeLessThanOrEqual(FRAME.width - EDGE)
    expect(after.bottom, corner).toBeLessThanOrEqual(FRAME.height - EDGE)
  }

  // In a window too short for the picker above or below the menu, the picker is held inside it.
  await open(page, 'more-reactions/short-window')
  const box = await boxOf(page)
  expect(box.top).toBe(EDGE)
  expect(box.left).toBe(41)
})
