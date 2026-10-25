import { expect, type Page } from '@playwright/test'
import { layoutTest as test, openState, type Route } from './support'

/**
 * The welcome card on Home (SPEC 4, "The welcome"; inventory, Home
 * "Welcome card"): it is whole above the field on every window, the
 * minimum one included, and a tick or "You're all set" moves nothing.
 * That Hide moves nothing is checked in the app (apps/desktop/e2e/welcome.spec.ts).
 * Light only: a theme changes colours, never a size.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox()
  if (found === null) throw new Error(`Nothing at ${selector}`)
  return found
}

test('Home\'s welcome card is whole above the field, unscrolled, on every window', async ({ page }) => {
  for (const state of ['welcome/fresh', 'welcome/minimum-window', 'welcome/minimum-window-all-set', 'welcome/short-window', 'welcome/narrow'] as const) {
    await open(page, 'Home', state)
    const frame = await box(page, `[data-fixture-frame="Home/${state}"]`)
    const card = await box(page, '[data-home-welcome] section')
    const chip = await box(page, 'button[aria-label^="Send to"]')
    expect(card.y, state).toBeGreaterThanOrEqual(frame.y)
    expect(card.x, state).toBeGreaterThanOrEqual(frame.x)
    expect(card.x + card.width, state).toBeLessThanOrEqual(frame.x + frame.width)
    // Clear of the destination chip, the top of the composer.
    expect(card.y + card.height, state).toBeLessThanOrEqual(chip.y)
    // Seen without scrolling: the column has not scrolled and nothing of the card is cut.
    expect(await page.locator('[data-home] > div').first().evaluate((node) => node.scrollTop), state).toBe(0)
  }
})

test('a tick and "You\'re all set" change no size in the card', async ({ page }) => {
  const sizes = []
  for (const state of ['states/fresh', 'states/one-done', 'states/two-done', 'states/all-set']) {
    await open(page, 'WelcomeCard', state)
    const card = await box(page, '[data-welcome]')
    const hints = await page.locator('[data-welcome-hint]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top))
    sizes.push({ width: card.width, height: card.height, hints })
  }
  for (const size of sizes.slice(1)) expect(size).toEqual(sizes[0])
})
