import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test.describe('attachment cards', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`alert, ${theme}: fields are two columns, each a muted label above a regular value`, async ({ page }) => {
      await openState(page, { component: 'AttachmentCard', id: 'alert', route: 'AttachmentCard/alert', group: '', groupId: '', state: 'alert', frame: {} }, theme)
      const at = await page.evaluate(() => {
        const fields = [...document.querySelectorAll('[data-field]')]
        return fields.map((field) => {
          const label = field.querySelector('[data-field-label]')!
          const value = label.nextElementSibling!
          const l = label.getBoundingClientRect()
          const v = value.getBoundingClientRect()
          return {
            left: l.left, valueLeft: v.left, top: l.top, below: v.top - l.bottom,
            labelColor: getComputedStyle(label).color, valueColor: getComputedStyle(value).color,
            labelSize: parseFloat(getComputedStyle(label).fontSize), valueSize: parseFloat(getComputedStyle(value).fontSize),
            valueWeight: getComputedStyle(value).fontWeight, text: label.textContent,
          }
        })
      })
      expect(at.map((field) => field.text)).toEqual(['Service', 'Status', 'Region', 'Started'])
      for (const field of at) {
        expect(field.valueLeft).toBe(field.left)
        expect(field.below).toBe(2)
        expect(field.labelColor).not.toBe(field.valueColor)
        expect(field.labelSize).toBeLessThan(field.valueSize)
        expect(field.valueWeight).toBe('400')
      }
      // Two columns: the second field sits beside the first, the third under it.
      expect(at[1]!.top).toBe(at[0]!.top)
      expect(at[1]!.left).toBeGreaterThan(at[0]!.left)
      expect(at[2]!.left).toBe(at[0]!.left)
      expect(at[3]!.left).toBe(at[1]!.left)
      expect(at[2]!.top).toBeGreaterThan(at[0]!.top)
    })
  }

  test('long: Show more starts where the body text starts and does not stretch', async ({ page }) => {
    await open(page, 'AttachmentCard', 'long')
    const at = await page.evaluate(() => {
      const card = document.querySelector('section[aria-label="Attachment"]')!
      const button = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Show more')!
      const textLeft = (element: Element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects()[0]!.left
      }
      return { button: textLeft(button), body: textLeft(card.querySelector('p')!), width: button.getBoundingClientRect().width, card: card.getBoundingClientRect().width }
    })
    expect(Math.abs(at.button - at.body)).toBeLessThan(1)
    expect(at.width).toBeLessThan(at.card / 2)
  })
})
