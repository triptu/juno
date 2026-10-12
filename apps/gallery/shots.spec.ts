import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

interface Route {
  readonly component: string
  readonly fixture: string
}

const shotsDir = join(import.meta.dirname, 'shots')
const themes = ['light', 'dark'] as const

/**
 * Opens the index once to read the route list, then screenshots every fixture
 * frame in both themes into shots/<component>/<fixture>-<theme>.png.
 */
test('screenshots every fixture in light and dark', async ({ page }) => {
  await page.goto('/#/')
  await page.evaluate(() => document.fonts.ready)
  const routes = await page.evaluate(
    () => (window as unknown as { __galleryRoutes: ReadonlyArray<Route> }).__galleryRoutes,
  )
  expect(routes.length).toBeGreaterThan(0)

  await rm(shotsDir, { recursive: true, force: true })

  for (const route of routes) {
    await mkdir(join(shotsDir, route.component), { recursive: true })
    for (const theme of themes) {
      await page.goto(`/#/${encodeURIComponent(route.component)}/${encodeURIComponent(route.fixture)}?theme=${theme}`)
      const frame = page.locator('[data-fixture-frame]')
      await expect(frame).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
      await frame.screenshot({
        path: join(shotsDir, route.component, `${route.fixture}-${theme}.png`),
        animations: 'disabled',
      })
    }
  }
})
