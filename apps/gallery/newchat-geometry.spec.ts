import { expect, test } from '@playwright/test'
import { openState } from './support'

test.describe('New chat frequent geometry', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const state of ['rows', 'chosen'] as const) {
      test(`${state}, ${theme}: names, insets and row widths align`, async ({ page }) => {
        const id = `frequent/${state}`
        await openState(page, { component: 'NewChat', id, route: `NewChat/${id}`, group: '', groupId: '', state, frame: {} }, theme)
        const at = await page.evaluate(() => {
          const root = document.querySelector('[data-new-chat]')!
          const origin = root.getBoundingClientRect()
          const block = root.querySelector('[data-frequent-block]')!
          const rows = [...block.querySelectorAll('[role="button"]')]
          const box = (element: Element) => {
            const b = element.getBoundingClientRect()
            return { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height }
          }
          const textX = (element: Element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            return range.getBoundingClientRect().x - origin.x
          }
          const b = block.getBoundingClientRect()
          const chips = root.querySelector('[aria-label="Destination"]')!.getBoundingClientRect()
          return {
            names: rows.map(row => textX(row.querySelector('[data-frequent-name]')!)),
            glyphs: rows.map(row => box(row.firstElementChild!.firstElementChild!).x),
            label: textX(block.firstElementChild!),
            hint: textX(block.lastElementChild!),
            rows: rows.map(box),
            lockGaps: rows.flatMap(row => {
              const lock = row.querySelector(':scope > span:nth-child(2) > svg')
              const name = row.querySelector('[data-frequent-name]')!
              return lock ? [lock.getBoundingClientRect().left - name.getBoundingClientRect().right] : []
            }),
            composer: box(root.querySelector('[data-composer-field]')!).x,
            above: b.top - origin.top,
            below: chips.top - b.bottom,
          }
        })
        expect(at.rows).toHaveLength(6)
        expect(new Set(at.names).size).toBe(1)
        expect(new Set([...at.glyphs, at.label, at.hint]).size).toBe(1)
        expect(new Set(at.rows.map(row => row.width)).size).toBe(1)
        for (const row of at.rows) {
          expect(row.x).toBe(at.composer)
          expect(row.height).toBe(32)
        }
        expect(at.lockGaps).toEqual([4])
        for (const [i, row] of at.rows.entries()) {
          if (i > 0) expect(row.y - at.rows[i - 1]!.y).toBe(row.height)
        }
        expect(at.above).toBeCloseTo(at.below, 1)
        console.log(`Frequent ${state} ${theme}: ${JSON.stringify(at)}`)
      })
    }
  }
})
