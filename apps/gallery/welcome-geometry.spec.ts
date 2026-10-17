import { expect, test, type Page } from '@playwright/test'
import { openState, type Route, type Theme } from './support'

/**
 * The welcome card on Home (SPEC 4, "The welcome"; inventory, Home
 * "Welcome card"): it is whole above the field on every window, the
 * minimum one included, and a tick, "You're all set" or Hide moves nothing.
 */

const open = (page: Page, component: string, id: string, theme: Theme = 'light') =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox()
  if (found === null) throw new Error(`Nothing at ${selector}`)
  return found
}

for (const state of ['welcome/fresh', 'welcome/minimum-window', 'welcome/minimum-window-all-set', 'welcome/short-window', 'welcome/narrow'] as const) {
  test(`Home's welcome card is whole above the field, unscrolled (${state})`, async ({ page }, info) => {
    for (const theme of ['light', 'dark'] as const) {
      await open(page, 'Home', state, theme)
      const frame = await box(page, `[data-fixture-frame="Home/${state}"]`)
      const card = await box(page, '[data-home-welcome] section')
      const chip = await box(page, 'button[aria-label^="Send to"]')
      expect(card.y).toBeGreaterThanOrEqual(frame.y)
      expect(card.x).toBeGreaterThanOrEqual(frame.x)
      expect(card.x + card.width).toBeLessThanOrEqual(frame.x + frame.width)
      // Clear of the destination chip, the top of the composer.
      expect(card.y + card.height).toBeLessThanOrEqual(chip.y)
      // Seen without scrolling: the column has not scrolled and nothing of the card is cut.
      expect(await page.locator('[data-home] > div').first().evaluate((node) => node.scrollTop)).toBe(0)
      await info.attach(`${state}-${theme}`, { body: await page.locator(`[data-fixture-frame="Home/${state}"]`).screenshot(), contentType: 'image/png' })
    }
  })
}

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

test('the room kept after Hide holds the rows where they were', async ({ page }) => {
  const rows = []
  for (const state of ['welcome/fresh', 'welcome/room-kept']) {
    await open(page, 'Home', state)
    rows.push(await page.locator('[data-home-item]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top)))
  }
  expect(rows[1]).toEqual(rows[0])
})
