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

// Like Mail: a wrapped title keeps its time, and the icons and tags beside it, on its first line. A zero-size inline
// block's bottom edge is the baseline of the line it starts.
for (const theme of ['light', 'dark'] as const) {
  for (const id of ['titles/one-line-compact', 'titles/two-lines-compact', 'titles/two-lines-comfortable', 'titles/two-lines-wrapped']) {
    test(`a row's time sits on its title's first line: ${id}, ${theme}`, async ({ page }) => {
      await openState(page, { component: 'TopicRow', id, route: `TopicRow/${id}`, frame: {}, group: 'Titles', groupId: 'titles', state: id.slice('titles/'.length) }, theme)
      const rows = await page.locator('[data-fixture-frame] [data-topic-row]').evaluateAll((nodes) => nodes.map((row) => {
        // In a flex box the text is an anonymous item: wrap it in a span, which lays out the same, and probe inside.
        const baseline = (node: Element) => {
          const flex = getComputedStyle(node).display.includes('flex')
          const line = flex ? document.createElement('span') : node
          if (flex) line.append(...node.childNodes), node.append(line)
          const probe = document.createElement('span')
          probe.style.cssText = 'display: inline-block; width: 0; height: 0'
          line.prepend(probe)
          const bottom = probe.getBoundingClientRect().bottom
          probe.remove()
          if (flex) node.append(...line.childNodes), line.remove()
          return bottom
        }
        const title = row.querySelector('[data-row-part="title"]')
        const time = row.querySelector('[data-row-part="time"]')!
        const box = title?.getBoundingClientRect()
        const lineHeight = title === null ? 0 : parseFloat(getComputedStyle(title).lineHeight)
        // Icons and tags on the title line: each within the first line's box.
        const beside = Array.from(time.parentElement!.children).filter((node) => node !== title && node !== time && node.tagName !== 'INPUT' && node.querySelector('input') === null)
        return {
          lines: box === undefined ? 0 : Math.round(box.height / lineHeight),
          title: title === null ? null : baseline(title),
          time: baseline(time),
          first: box === undefined ? null : { top: box.top, bottom: box.top + lineHeight },
          beside: beside.map((node) => {
            const rect = node.getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom }
          }),
        }
      }))
      expect(rows.length).toBeGreaterThan(1)
      if (id !== 'titles/one-line-compact') expect(rows.filter((row) => row.lines === 2).length).toBeGreaterThan(0)
      for (const row of rows) {
        if (row.title === null || row.first === null) continue
        expect(Math.abs(row.time - row.title)).toBeLessThanOrEqual(1)
        for (const part of row.beside) {
          expect(part.top).toBeGreaterThanOrEqual(row.first.top - 1)
          expect(part.bottom).toBeLessThanOrEqual(row.first.bottom + 1)
        }
      }
    })
  }
}
