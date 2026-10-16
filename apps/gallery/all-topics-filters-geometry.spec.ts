// The All topics filter row (inventory 10): the status tabs, the kind, the
// place picker and the sort sit on a line, or wrap onto more lines on a
// narrow window, with one height, even gaps and nothing overlapping.
import { expect, test } from '@playwright/test'
import { openState } from './support'

const STATES = ['default', 'place-picked', 'picker-open', 'picker-query', 'narrow'] as const

test.describe('All topics filter row geometry', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const state of STATES) {
      test(`${state}, ${theme}: controls do not overlap, share a height and gap, and fit the row`, async ({ page }) => {
        const id = `filters/${state}`
        await openState(page, { component: 'AllTopics', id, route: `AllTopics/${id}`, group: '', groupId: '', state, frame: {} }, theme)
        const at = await page.evaluate(() => {
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
            extras: [...row.querySelectorAll('button, select, [role="button"]')].filter((element) => !controls.some((control) => control === element || control.contains(element))).length,
            clipped: controls.filter((control) => control.scrollWidth > control.clientWidth + 1).length,
            segments: segments.map(box),
            segmentsClipped: segments.filter((segment) => segment.scrollWidth > segment.clientWidth).length,
            counts: segments.map((segment) => {
              const count = segment.lastElementChild!
              const style = getComputedStyle(count)
              return { numeric: style.fontVariantNumeric, color: style.color, label: getComputedStyle(segment).color }
            }),
          }
        })
        expect(at.extras).toBe(0)
        expect(at.clipped).toBe(0)

        // One height.
        expect(new Set(at.controls.map((control) => control.height))).toEqual(new Set([28]))

        // No two controls overlap, and each stays inside the row.
        for (const [i, a] of at.controls.entries()) {
          expect(a.x).toBeGreaterThanOrEqual(at.row.x - 0.5)
          expect(a.right).toBeLessThanOrEqual(at.row.right + 0.5)
          for (const b of at.controls.slice(i + 1)) {
            const apart = a.right <= b.x + 0.5 || b.right <= a.x + 0.5 || a.bottom <= b.y + 0.5 || b.bottom <= a.y + 0.5
            expect(apart, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(true)
          }
        }

        // Kind, place and sort sit together: on one line their gaps are equal (8px).
        const [, kind, place, sort] = at.controls as [unknown, (typeof at.controls)[number], (typeof at.controls)[number], (typeof at.controls)[number]]
        if (kind.y === place.y) expect(place.x - kind.right).toBeCloseTo(8, 0)
        if (place.y === sort.y) expect(sort.x - place.right).toBeCloseTo(8, 0)

        // The status tabs: content-sized, with even gaps, counts muted and tabular.
        expect(at.segmentsClipped).toBe(0)
        expect(new Set(at.segments.map((segment) => Math.round(segment.width))).size).toBeGreaterThan(1)
        const gaps = at.segments.slice(1).map((segment, i) => Math.round((segment.x - at.segments[i]!.right) * 10) / 10)
        expect(new Set(gaps).size).toBe(1)
        for (const count of at.counts) expect(count.numeric).toContain('tabular-nums')
        // The selected tab's label is in the default colour, its count stays muted.
        expect(at.counts[0]!.color).not.toBe(at.counts[0]!.label)
        console.log(`All topics filters ${state} ${theme}: ${JSON.stringify(at)}`)
      })
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`picker-query, ${theme}: the searchable list opens below the place button with avatars, # and the group icon`, async ({ page }) => {
      const id = 'filters/picker-query'
      await openState(page, { component: 'AllTopics', id, route: `AllTopics/${id}`, group: '', groupId: '', state: 'picker-query', frame: {} }, theme)
      const dialog = page.getByRole('dialog', { name: 'Pick a place' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox')).toHaveValue('ma')
      await expect(dialog.getByRole('option')).toHaveCount(3)
      await expect(dialog.getByRole('option', { name: /^Anywhere/ })).toHaveCount(0)
      // Maya's DM shows her avatar; the group DM and the channel show their kind's icon.
      const options = dialog.getByRole('option')
      await expect(options.nth(0).locator('[data-kind="person"]')).toBeVisible()
      await expect(options.nth(1).locator('svg')).toBeVisible()
      await expect(options.nth(2).locator('svg')).toBeVisible()
      const [button, panel] = await Promise.all([page.getByRole('button', { name: /^Where: / }).boundingBox(), dialog.boundingBox()])
      expect(panel!.y).toBeGreaterThan(button!.y + button!.height - 1)
    })
  }
})
