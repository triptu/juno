import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Home's Automated question (inventory, Home "Automated"): its title and
 * meta lines start at one edge, the reason takes an ellipsis before the
 * buttons, and the buttons sit the same distance from the row's top and
 * bottom.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

for (const [state, title, meta] of [
  ['items/automated', 'Move #releases?', 'To Automated · Apps wrote 18 of the last 30 messages'],
  ['items/automated-juno', 'Move #vendor-status-updates?', 'To Automated · Status updates from an app, a few replies'],
] as const) {
  test(`Home Automated keeps its two lines aligned, says why it asks, and insets its actions evenly (${state})`, async ({ page }) => {
    await open(page, 'Home', state)
    const row = page.locator('[data-home-item=automated]')
    await row.hover()
    await expect(row.locator('[data-home-title]')).toHaveText(title)
    await expect(row.locator('[data-home-meta]')).toHaveText(meta)
    const at = await row.evaluate((node) => {
      const title = node.querySelector('[data-home-title]')!.getBoundingClientRect()
      const meta = node.querySelector('[data-home-meta]')!.getBoundingClientRect()
      const buttons = [...node.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
      const slot = node.getBoundingClientRect()
      return { title: title.left, meta: meta.left, metaEnd: meta.right, buttons: buttons.map((box) => ({ top: box.top - slot.top, bottom: slot.bottom - box.bottom })), first: buttons[0]!.left, gap: buttons[1]!.left - buttons[0]!.right }
    })
    expect(at.title).toBe(at.meta)
    // A long reason takes an ellipsis before the buttons; it never runs under them.
    expect(at.metaEnd).toBeLessThanOrEqual(at.first)
    for (const button of at.buttons) expect(button).toEqual({ top: 12, bottom: 12 })
    expect(at.gap).toBeGreaterThan(0)
  })
}
