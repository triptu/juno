import { expect, test } from '@playwright/test'
import { openState } from './support'

/**
 * Home's writing stack (SPEC section 12, "Writing"): Recent, the
 * destination chip and the field share the field's left edge; Recent's
 * names start on one edge in each column, its label on the marks' edge;
 * the chip sits closer to the field than to Recent, so the three read as
 * one stack with the chip labelling the field.
 */
test.describe('Home writing geometry', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const state of ['juno', 'maya-chosen', 'multiline', 'few-recent'] as const) {
      test(`${state}, ${theme}: Recent, the chip and the field line up`, async ({ page }) => {
        const id = `write/${state}`
        await openState(page, { component: 'Home', id, route: `Home/${id}`, group: '', groupId: '', state, frame: {} }, theme)
        const at = await page.evaluate(() => {
          const recent = document.querySelector('[data-home-recent]')!
          const field = document.querySelector('[data-composer-field]')!.getBoundingClientRect()
          const chip = document.querySelector('[aria-label^="Send to:"]')!.getBoundingClientRect()
          const textX = (element: Element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            return range.getBoundingClientRect().x
          }
          const columns = [...recent.querySelectorAll('ul')].map((list) =>
            [...list.querySelectorAll('button')].map((row) => {
              const box = row.getBoundingClientRect()
              const name = row.querySelector('span:nth-child(2)')!
              const mark = row.querySelector('span:first-child > *')!.getBoundingClientRect()
              return { x: box.x, height: box.height, name: textX(name), mark: mark.x, bottom: box.bottom }
            }),
          )
          return {
            field: field.x,
            fieldTop: field.top,
            chip: chip.x,
            chipTop: chip.top,
            chipBottom: chip.bottom,
            label: textX(recent.querySelector('h3')!),
            columns,
          }
        })
        expect(at.columns).toHaveLength(2)
        for (const column of at.columns) {
          expect(column).toHaveLength(state === 'few-recent' ? 2 : 5)
          expect(new Set(column.map((row) => row.name)).size).toBe(1)
          for (const row of column) expect(row.height).toBe(32)
        }
        const left = at.columns[0]!
        for (const row of left) expect(row.x).toBe(at.field)
        expect(at.chip).toBe(at.field)
        expect(Math.round(at.label)).toBe(Math.round(left[0]!.mark))
        const recentToChip = at.chipTop - Math.max(...at.columns.flat().map((row) => row.bottom))
        const chipToField = at.fieldTop - at.chipBottom
        expect(chipToField).toBeGreaterThan(0)
        expect(recentToChip).toBeGreaterThan(chipToField)
        // The last row sits on the chip, 12 above it, however many rows Recent has.
        expect(recentToChip).toBe(12)
        console.log(`Home write ${state} ${theme}: ${JSON.stringify({ recentToChip, chipToField })}`)
      })
    }
  }

  test('the chosen destination’s Recent row takes its tint, and a hovered row reads apart from it', async ({ page }) => {
    const id = 'write/maya-chosen'
    await openState(page, { component: 'Home', id, route: `Home/${id}`, group: '', groupId: '', state: 'maya-chosen', frame: {} }, 'light')
    const rows = page.locator('[data-home-recent] button')
    await rows.nth(1).hover()
    const fills = await rows.evaluateAll((all) => all.map((row) => getComputedStyle(row).backgroundColor))
    expect(fills[0]).not.toBe('rgba(0, 0, 0, 0)')
    expect(fills[1]).not.toBe(fills[0])
    expect(fills[2]).toBe('rgba(0, 0, 0, 0)')
  })
})
