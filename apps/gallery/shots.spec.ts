import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openState, readRoutes, type Route } from './support'

const shotsDir = join(import.meta.dirname, 'shots')
const themes = ['light', 'dark'] as const

/** Puts the state into the look its frame asks for; returns the cleanup. */
async function arrange(page: Page, route: Route): Promise<() => Promise<void>> {
  const frame = page.locator('[data-fixture-frame]')
  const { hover, press, focus } = route.frame
  // The pointer stays where the last state left it; park it off the frame so
  // a state that asks for no hover does not show one.
  await page.mouse.move(0, 0)
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
    if (!box) throw new Error(`Nothing to press at ${press} in ${route.route}`)
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
 * Screenshots every state frame in both themes into
 * shots/<Component>/<group>/<state>-<theme>.png (no group folder for a state
 * declared without a group).
 */
test('screenshots every state in light and dark', async ({ page }) => {
  // One test walks every state twice, a navigation each: a few minutes for
  // the whole gallery, past the default timeout.
  test.setTimeout(10 * 60_000)
  const routes = await readRoutes(page)
  await page.evaluate(() => document.fonts.ready)

  await rm(shotsDir, { recursive: true, force: true })

  for (const route of routes) {
    for (const theme of themes) {
      const path = join(shotsDir, `${route.route}-${theme}.png`)
      await mkdir(dirname(path), { recursive: true })
      await openState(page, route, theme)
      const release = await arrange(page, route)
      await page.locator(`[data-fixture-frame="${route.route}"]`).screenshot({ path, animations: 'disabled' })
      await release()
    }
  }
  expect(routes.length).toBeGreaterThan(0)
})
