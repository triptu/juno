// The All topics filter row (inventory 10): the status tabs, the kind, the
// place picker and the sort sit on a line, or wrap onto more lines on a
// narrow window, with one height, even gaps and nothing overlapping.
import { expect, test } from '@playwright/test'
import { openState } from './support'

/** The filter row's controls and status tabs, as the page lays them out. */
function measure() {
  const row = document.querySelector('[data-all-topics-filters]')!
  const box = (element: Element) => {
    const b = element.getBoundingClientRect()
    return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }
  }
  const controls = [
    row.querySelector('[role="radiogroup"][aria-label="Status"]')!,
    row.querySelector('[role="radiogroup"][aria-label="Kind"]')!,
    row.querySelector('button[aria-label^="Where: "]')!,
    row.querySelector('select[aria-label="Sort"]')!,
  ]
  const segments = [...row.querySelectorAll('[role="radiogroup"][aria-label="Status"] [role="radio"]')]
  return {
    row: box(row),
    controls: controls.map(box),
    // Everything the pointer can press in the row, outside the four controls: a stray chevron would show here.
    // The Status pop-up of a compact page is not drawn at these widths.
    extras: [...row.querySelectorAll('button, select, [role="button"]')].filter((element) => element.getClientRects().length > 0 && !controls.some((control) => control === element || control.contains(element))).length,
    clipped: controls.filter((control) => control.scrollWidth > control.clientWidth + 1).length,
    segments: segments.map(box),
    segmentsClipped: segments.filter((segment) => segment.scrollWidth > segment.clientWidth).length,
    counts: segments.map((segment) => {
      const count = segment.lastElementChild!
      const style = getComputedStyle(count)
      return { numeric: style.fontVariantNumeric, color: style.color, label: getComputedStyle(segment).color }
    }),
  }
}

const STATES = ['default', 'place-picked', 'picker-open', 'picker-query', 'narrow'] as const

test.describe('All topics filter row geometry', () => {
  for (const theme of ['light'] as const) {
    for (const state of STATES) {
      test(`${state}, ${theme}: controls do not overlap or clip and fit the row`, async ({ page }) => {
        const id = `filters/${state}`
        await openState(page, { component: 'AllTopics', id, route: `AllTopics/${id}`, group: '', groupId: '', state, frame: {} }, theme)
        const at = await page.evaluate(measure)
        expect(at.extras).toBe(0)
        expect(at.clipped).toBe(0)

        // One height.
        expect(new Set(at.controls.map((control) => control.height)).size).toBe(1)

        // No two controls overlap, and each stays inside the row.
        for (const [i, a] of at.controls.entries()) {
          expect(a.x).toBeGreaterThanOrEqual(at.row.x - 0.5)
          expect(a.right).toBeLessThanOrEqual(at.row.right + 0.5)
          for (const b of at.controls.slice(i + 1)) {
            const apart = a.right <= b.x + 0.5 || b.right <= a.x + 0.5 || a.bottom <= b.y + 0.5 || b.bottom <= a.y + 0.5
            expect(apart, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(true)
          }
        }

        expect(at.segmentsClipped).toBe(0)

      })
    }
  }
})

test.describe('All topics place picker', () => {
  for (const theme of ['light'] as const) {
    test(`picker-query, ${theme}: the searchable list opens below the place button with Recent's marks`, async ({ page }) => {
      const id = 'filters/picker-query'
      await openState(page, { component: 'AllTopics', id, route: `AllTopics/${id}`, group: '', groupId: '', state: 'picker-query', frame: {} }, theme)
      const dialog = page.getByRole('dialog', { name: 'Pick a place' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox')).toHaveValue('ma')
      await expect(dialog.getByRole('option')).toHaveCount(3)
      await expect(dialog.getByRole('option', { name: /^Anywhere/ })).toHaveCount(0)
      // Recent's marks: Maya's face, the group DM's pair of faces, the channel's tile; each 20px, so the names start on one edge.
      const options = dialog.getByRole('option')
      await expect(options.nth(0).locator('[data-kind="person"]')).toBeVisible()
      await expect(options.nth(1).locator('[data-group-avatar]')).toBeVisible()
      await expect(options.nth(2).locator('[data-kind]')).toHaveCount(0)
      const [button, panel] = await Promise.all([page.getByRole('button', { name: /^Where: / }).boundingBox(), dialog.boundingBox()])
      expect(panel!.y).toBeGreaterThan(button!.y + button!.height - 1)
    })
  }
})
