import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The pictures in a message: a lone image inside the 360 × 240 box, and a
 * message's several images as one grid of that size, laid out by count.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test.describe('message images', () => {
  test('one image fits 360 by 240', async ({ page }) => {
    await open(page, 'MessageList', 'files/thumbnails')
    const single = await page.evaluate(() =>
      [...document.querySelectorAll('[data-thumbnail]')]
        .filter((thumb) => thumb.closest('[data-thumbnail-grid]') === null)
        .map((element) => {
          const b = element.getBoundingClientRect()
          return { width: b.width, height: b.height }
        }),
    )
    expect(single.length).toBeGreaterThan(0)
    for (const thumb of single) {
      expect(thumb.width).toBeLessThanOrEqual(360)
      expect(thumb.height).toBeLessThanOrEqual(240)
    }
  })

  // Every grid is the 360 × 240 thumbnail box: 2 side by side, 3 with the first tall, 4 in 2 × 2, more as "+N" on the fourth.
  const layouts = {
    'grid-2': [[177, 240], [177, 240]],
    'grid-3': [[177, 240], [177, 117], [177, 117]],
    'grid-4': [[177, 117], [177, 117], [177, 117], [177, 117]],
    'grid-6': [[177, 117], [177, 117], [177, 117], [177, 117]],
  } as const
  for (const [state, cells] of Object.entries(layouts)) {
    test(`a message's pictures: ${state}`, async ({ page }) => {
      await open(page, 'MessageList', `media/${state}`)
      const at = await page.evaluate(() => {
        const grid = document.querySelector('[data-thumbnail-grid]')!
        const size = (element: Element) => {
          const b = element.getBoundingClientRect()
          return { left: b.left, width: b.width, height: b.height }
        }
        return { grid: size(grid), cells: [...grid.querySelectorAll('[data-thumbnail]')].map(size), more: [...grid.querySelectorAll('[data-more]')].map((node) => node.textContent) }
      })
      expect({ width: at.grid.width, height: at.grid.height }).toEqual({ width: 360, height: 240 })
      expect(at.cells.map((cell) => [cell.width, cell.height])).toEqual(cells)
      expect(at.cells[1]!.left - (at.cells[0]!.left + at.cells[0]!.width)).toBe(6)
      expect(at.more).toEqual(state === 'grid-6' ? ['+2'] : [])
    })
  }
})
