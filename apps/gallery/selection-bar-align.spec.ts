import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectCentred, measure } from './ink'
import { openState, type Route, type Theme } from './support'

/**
 * Quote and Ask Juno in the selection's bar are centred on the bar: the
 * painted part of each icon, read from a screenshot (`ink.ts`), has its
 * centre within half a pixel of the bar's centre line and of its button's
 * centre, and the outer insets match.
 */

const open = (page: Page, component: string, id: string, theme: Theme) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

/** The bar's insets before its first button and after its last. */
const spacing = (bar: Locator) =>
  bar.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
    return { start: buttons[0]!.left - box.left, end: box.right - buttons.at(-1)!.right }
  })

for (const theme of ['light', 'dark'] as const) {
  test(`the selection's bar (${theme}): Quote and Ask Juno are icons centred on the bar`, async ({ page }) => {
    await open(page, 'TopicView', 'interaction/selection-quote', theme)
    const bar = page.getByRole('toolbar', { name: 'Selection' })
    const found = await measure(page, bar)
    expect(found.items.map((item) => item.name)).toEqual(['Quote', 'Ask Juno ⌘J'])
    expectCentred(found)
    const at = await spacing(bar)
    expect(at.start).toBe(at.end)
  })
}
