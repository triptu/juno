import { expect, test } from '@playwright/test'
import { openState } from './support'

for (const theme of ['light', 'dark'] as const) {
  for (const density of ['compact', 'comfortable'] as const) {
    test(`topic titles wrap only when needed: ${theme}, ${density}`, async ({ page }) => {
      const heights: number[][] = []
      for (const lines of ['one-line', 'two-lines']) {
        const id = `titles/${lines}-${density}`
        await openState(page, { component: 'TopicRow', id, route: `TopicRow/${id}`, frame: {}, group: 'Titles', groupId: 'titles', state: `${lines}-${density}` }, theme)
        const rows = page.locator('[data-fixture-frame] [data-topic-row]')
        heights.push(await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)))
        const short = rows.first().locator('[data-row-part="title"]')
        await short.hover()
        await expect(short).not.toHaveAttribute('title')
        const fits = rows.nth(1).locator('[data-row-part="title"]')
        await fits.hover()
        if (lines === 'two-lines') await expect(fits).not.toHaveAttribute('title')
        const long = rows.nth(2).locator('[data-row-part="title"]')
        await long.hover()
        await expect(long).toHaveAttribute('title')
        const lineCount = await long.evaluate((node) => node.clientHeight / parseFloat(getComputedStyle(node).lineHeight))
        expect(lineCount).toBe(lines === 'one-line' ? 1 : 2)
      }
      expect(heights[0]![0]).toBe(density === 'compact' ? 80 : 88)
      expect(heights[0]![3]).toBe(density === 'compact' ? 58 : 64)
      expect(heights[1]![0]).toBe(heights[0]![0])
      expect(heights[1]![2]).toBeGreaterThan(heights[0]![2]!)
      expect(heights[1]![3]).toBe(heights[0]![3])
    })
  }
}

for (const component of ['AllTopics', 'Home', 'TopicSwitcher']) {
  test(`${component} grows its title rows without overlaps`, async ({ page }) => {
    await openState(page, { component, id: 'titles/two-lines', route: `${component}/titles/two-lines`, frame: {}, group: 'Titles', groupId: 'titles', state: 'two-lines' })
    const selector = component === 'AllTopics' ? '[data-all-topics-row]' : component === 'Home' ? '[data-home-item]' : '[role="option"]'
    const rows = page.locator(`[data-fixture-frame] ${selector}`)
    expect(await rows.count()).toBeGreaterThan(1)
    if (component === 'Home' || component === 'AllTopics') expect((await rows.nth(1).boundingBox())!.height).toBe(52)
    const boxes = await rows.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }))
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom)
  })
}
