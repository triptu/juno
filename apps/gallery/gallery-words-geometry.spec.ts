import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The gallery's quotes and facts (SPEC 12, "Quotes and facts"): the columns
 * share the page's width evenly with the picture rows' 20 gap between them,
 * and a single column on a narrow page stops at a reading length.
 */

const open = (page: Page, id: string) =>
  openState(page, { component: 'Gallery', id, route: `Gallery/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

const columnsOf = (page: Page) =>
  page.locator('[data-gallery]').evaluate((node) => {
    const list = node.querySelector('section[data-gallery-words] ul')!.getBoundingClientRect()
    const entries = [...node.querySelectorAll('section[data-gallery-words] li')].map((entry) => entry.getBoundingClientRect())
    const lefts = [...new Set(entries.map((entry) => Math.round(entry.left)))].sort((a, b) => a - b)
    return { list: { left: list.left, right: list.right }, lefts, widths: [...new Set(entries.map((entry) => Math.round(entry.width)))] }
  })

for (const [state, columns] of [
  ['words/quotes', 3],
  ['words/quotes-wide', 4],
  ['words/facts-wide', 5],
] as const) {
  test(`the gallery's words fill the page in even columns (${state})`, async ({ page }) => {
    // Room for the widest frame beside the gallery's own list of components.
    await page.setViewportSize({ width: 2400, height: 1000 })
    await open(page, state)
    const at = await columnsOf(page)
    // Every entry is as wide as an even share of the list, and starts on that grid: no empty space between or after the columns.
    const width = (at.list.right - at.list.left - (columns - 1) * 20) / columns
    expect(width).toBeGreaterThanOrEqual(290)
    expect(at.widths).toHaveLength(1)
    expect(Math.abs(at.widths[0]! - width)).toBeLessThanOrEqual(1)
    for (const left of at.lefts) {
      const column = Math.round((left - at.list.left) / (width + 20))
      expect(Math.abs(left - (at.list.left + column * (width + 20))), `entry at ${left}`).toBeLessThanOrEqual(1)
    }
  })
}

test("a single column of the gallery's words stops at a reading length", async ({ page }) => {
  await open(page, 'words/quotes-narrow')
  const at = await columnsOf(page)
  expect(at.lefts).toHaveLength(1)
  expect(at.widths[0]).toBeLessThanOrEqual(290 * 1.5 + 20)
  expect(at.widths[0]).toBeLessThan(at.list.right - at.list.left)
})
