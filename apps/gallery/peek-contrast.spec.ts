import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

for (const theme of ['light', 'dark'] as const) {
  for (const accent of ['coral', 'ink', 'marigold', 'teal', 'midnight', 'emerald', 'claret', 'cyan']) {
    test(`PeekView separates from a topic: ${theme}, ${accent}`, async ({ page }, info) => {
      const routes = (await readRoutes(page)).filter((route) => route.component === 'PeekView' && route.groupId === 'over-topic')
      expect(routes).toHaveLength(2)
      for (const route of routes) {
        await openState(page, route, theme)
        await page.goto(`${page.url()}&accent=${accent}`)
        await expect(page.locator('[data-peek]')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
        const frame = page.locator('[data-fixture-frame]')
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
          return { surface, background, contrast: ratio(surface, background), border: style.borderColor, shadow: style.boxShadow, text,
            boxes: [node, ...node.querySelectorAll('*')].map((element) => { const box = element.getBoundingClientRect(); return [box.x, box.y, box.width, box.height] }) }
        })
        const after = await measure()
        for (const item of after.text) expect(item.contrast, JSON.stringify(item)).toBeGreaterThanOrEqual(4.5)
        if (theme === 'light') expect(after.contrast).toBeGreaterThan(1.03)
        if (accent === 'coral') await info.attach(`${route.state}-${theme}-after`, { body: await frame.screenshot({ path: info.outputPath(`${route.state}-${theme}-after.png`) }), contentType: 'image/png' })
        // Reproduce the original popover material without changing its DOM or geometry.
        await panel.evaluate((node) => {
          node.style.backgroundColor = 'var(--surface-raised)'
          node.style.boxShadow = 'var(--pop-shadow)'
        })
        const before = await measure()
        expect(after.boxes).toEqual(before.boxes)
        if (theme === 'dark') {
          expect(after.surface).toEqual(before.surface)
          expect(after.shadow).toBe(before.shadow)
        }
        if (accent === 'coral') await info.attach(`${route.state}-${theme}-before`, { body: await frame.screenshot({ path: info.outputPath(`${route.state}-${theme}-before.png`) }), contentType: 'image/png' })
        await writeFile(info.outputPath(`${route.state}-${theme}-${accent}.json`), JSON.stringify({ before, after }, null, 2))
        await info.attach(`${route.state}-${theme}-${accent}-measurements`, { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' })
      }
    })
  }
}
