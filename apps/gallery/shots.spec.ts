import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

interface Route {
  readonly component: string
  readonly fixture: string
  readonly frame: {
    readonly hover?: string
    readonly press?: string
    readonly focus?: string
  }
}

const shotsDir = join(import.meta.dirname, 'shots')
const themes = ['light', 'dark'] as const

/** Puts the fixture into the state its frame asks for; returns the cleanup. */
async function arrange(page: Page, route: Route): Promise<() => Promise<void>> {
  const frame = page.locator('[data-fixture-frame]')
  const { hover, press, focus } = route.frame
  if (focus) {
    await frame.locator(focus).first().focus()
    // Keyboard focus, so :focus-visible matches: tab away and back.
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
  }
  if (hover) await frame.locator(hover).first().hover()
  if (press) {
    // The press scale is a transition that reduced motion collapses, so the
    // shot runs with motion on and waits for the 150ms to finish.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const box = await frame.locator(press).first().boundingBox()
    if (!box) throw new Error(`Nothing to press at ${press} in ${route.component}/${route.fixture}`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(200)
    return async () => {
      await page.mouse.up()
      await page.emulateMedia({ reducedMotion: 'reduce' })
    }
  }
  return async () => {}
}

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
      const frame = page.locator(`[data-fixture-frame="${route.component}/${route.fixture}"]`)
      await expect(frame).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
      const release = await arrange(page, route)
      await frame.screenshot({
        path: join(shotsDir, route.component, `${route.fixture}-${theme}.png`),
        animations: 'disabled',
      })
      await release()
    }
  }
})
