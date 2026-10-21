import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

test.use({ reducedMotion: 'no-preference' })

test('IconButtons keep their box and transform throughout a held press and release', async ({ page }) => {
  const routes = (await readRoutes(page)).filter((route) => route.component === 'IconButton' && route.group === 'Titlebar and header')
  expect(routes.length).toBeGreaterThan(0)
  for (const route of routes) {
    await openState(page, route, 'light')
    const button = page.locator(`[data-fixture-frame="${route.route}"] button`).first()
    await button.hover()
    const read = () => button.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const styles = [element, ...element.querySelectorAll('span, svg')].map((node) => {
        const style = getComputedStyle(node)
        return { transform: style.transform, scale: style.scale, translate: style.translate }
      })
      return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, styles }
    })
    const before = await read()
    for (const style of before.styles) expect(style).toEqual({ transform: 'none', scale: 'none', translate: 'none' })
    await page.mouse.down()
    // Read each rendered frame, including the start and end of the former spring.
    for (let frame = 0; frame < 20; frame++) {
      await page.evaluate(() => new Promise(requestAnimationFrame))
      expect(await read(), `${route.route}: held frame ${frame}`).toEqual(before)
    }
    await page.mouse.up()
    for (let frame = 0; frame < 20; frame++) {
      await page.evaluate(() => new Promise(requestAnimationFrame))
      expect(await read(), `${route.route}: released frame ${frame}`).toEqual(before)
    }
  }
})
