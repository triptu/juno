import { expect } from '@playwright/test'
import { openState, paintTest as test, readRoutes } from './support'

for (const theme of ['light', 'dark'] as const) {
  test(`PeekView separates from a topic: ${theme}, coral and ink`, async ({ page }) => {
    const routes = (await readRoutes(page)).filter((route) => route.component === 'PeekView' && route.groupId === 'over-topic')
    expect(routes).toHaveLength(2)
    for (const accent of ['coral', 'ink']) {
      for (const route of routes) {
        await openState(page, route, theme, accent)
        await expect(page.locator('[data-peek]')).toBeVisible()
        const panel = page.locator('[data-peek] > div')
        const measure = () => panel.evaluate((node) => {
          const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
          const rgb = (value: string) => {
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = value
            context.fillRect(0, 0, 1, 1)
            return [...context.getImageData(0, 0, 1, 1).data]
          }
          const luminance = (values: number[]) => values.slice(0, 3).reduce((sum, value, i) => {
            const v = value / 255
            return sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
          }, 0)
          const ratio = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
          const backdrop = (element: Element): number[] => {
            for (let at: Element | null = element; at; at = at.parentElement) {
              const value = rgb(getComputedStyle(at).backgroundColor)
              if (value[3] === 255) return value
            }
            return rgb(getComputedStyle(document.body).backgroundColor)
          }
          const style = getComputedStyle(node)
          const surface = rgb(style.backgroundColor)
          const probe = document.createElement('span')
          probe.style.color = 'var(--background)'
          node.append(probe)
          const background = rgb(getComputedStyle(probe).color)
          probe.remove()
          const text = [...node.querySelectorAll('*')].filter((element) =>
            [...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) || element.tagName.toLowerCase() === 'svg',
          ).filter((element) => element.getBoundingClientRect().width > 0).map((element) => ({
            text: element.textContent?.slice(0, 50) ?? element.tagName,
            contrast: ratio(rgb(getComputedStyle(element).color), backdrop(element)),
          }))
          return { contrast: ratio(surface, background), text }
        })
        const after = await measure()
        for (const item of after.text) expect(item.contrast, `${accent}, ${route.route}: ${JSON.stringify(item)}`).toBeGreaterThanOrEqual(4.5)
        // The panel's surface reads apart from the page behind it.
        if (theme === 'light') expect(after.contrast, `${accent}, ${route.route}`).toBeGreaterThan(1.03)
      }
    }
  })
}
