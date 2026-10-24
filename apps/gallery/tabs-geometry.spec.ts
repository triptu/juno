import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The tab strip's close buttons (inventory 4, decided 10-17): never a Tab
 * stop, never inside the `tab` element, and named by the tab as its action.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test('a tab names its close button as its action; the button is its sibling and not a Tab stop', async ({ page }) => {
  await open(page, 'Tabs', 'strip/many')
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const id = tab.getAttribute('aria-actions')
      const button = id === null ? null : document.getElementById(id)
      return {
        hasAction: button !== null,
        nested: tab.querySelector('button') !== null,
        sibling: button?.closest('[data-tab]') === tab.parentElement,
        tabStop: button === null ? false : button.tabIndex >= 0,
      }
    }),
  )
  const closable = tabs.filter((tab) => tab.hasAction)
  expect(closable.length).toBeGreaterThan(1)
  for (const tab of tabs) expect(tab.nested).toBe(false)
  for (const tab of closable) expect(tab).toMatchObject({ sibling: true, tabStop: false })
})

test('Tab from the active tab goes to "+", past every close button', async ({ page }) => {
  await open(page, 'Tabs', 'strip/many')
  await page.locator('[role="tab"][aria-selected="true"]').focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/^New (chat|tab)/)
})

/**
 * Tab separation (inventory 4, decided 10-16): inactive tabs sit on a fill
 * apart from the active one, a divider shows only between two inactive tabs
 * that are not hovered, and neither hover nor a switch moves a tab.
 */

/** Per tab: its box, its fill, and whether the divider at its start can be seen. */
const readTabs = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-tab]')].map((box, index, boxes) => {
      const tab = box.querySelector<HTMLElement>(':scope > [role="tab"]')!
      const rect = box.getBoundingClientRect()
      const divider = Number(getComputedStyle(box.querySelector('[data-tab-divider]')!).opacity)
      const previous = boxes[index - 1]
      const covered = previous === undefined ? false : Number(getComputedStyle(previous.querySelector('[data-tab-cover]')!).opacity) === 1
      return {
        active: tab.getAttribute('aria-selected') === 'true',
        rect: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
        fill: getComputedStyle(tab).backgroundColor,
        divider: divider === 1 && !covered,
        hovered: box.matches(':hover'),
      }
    }),
  )

/** WCAG contrast of two `rgb()` colours. */
function contrast(a: string, b: string): number {
  const luminance = (rgb: string) => {
    const [r = 0, g = 0, bl = 0] = (rgb.match(/[\d.]+/g) ?? []).map(Number).map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: inactive tabs read apart from the active one, with dividers only between inactive tabs`, async ({ page }) => {
    await openState(page, { component: 'Tabs', id: 'with-page/three-first-active', route: 'Tabs/with-page/three-first-active', group: '', groupId: '', state: '', frame: {} }, theme)
    const tabs = await readTabs(page)
    expect(tabs.map((tab) => tab.active)).toEqual([true, false, false])
    // Only the divider between the two inactive tabs shows.
    expect(tabs.map((tab) => tab.divider)).toEqual([false, false, true])
    expect(contrast(tabs[0]!.fill, tabs[1]!.fill)).toBeGreaterThanOrEqual(1.07)

    // Hover on the last tab: its fill changes, its divider goes, and nothing moves.
    await page.locator('[data-tab]').nth(2).hover()
    // Reduced motion leaves a 0.01ms transition on the divider's opacity: let it land.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
    const hovered = await readTabs(page)
    expect(hovered.map((tab) => tab.hovered)).toEqual([false, false, true])
    expect(hovered.map((tab) => tab.divider)).toEqual([false, false, false])
    expect(contrast(hovered[2]!.fill, tabs[2]!.fill)).toBeGreaterThanOrEqual(1.04)
    expect(contrast(hovered[2]!.fill, tabs[0]!.fill)).toBeGreaterThanOrEqual(1.04)
    expect(hovered.map((tab) => tab.rect)).toEqual(tabs.map((tab) => tab.rect))
  })
}

test('with the middle of three tabs active, both dividers next to it hide; twelve tabs keep one divider per inactive pair', async ({ page }) => {
  await open(page, 'Tabs', 'with-page/three-middle-active')
  expect((await readTabs(page)).map((tab) => tab.divider)).toEqual([false, false, false])
  await open(page, 'Tabs', 'with-page/twelve')
  const twelve = await readTabs(page)
  // Active is the sixth: no divider at its start or the start of the seventh, and none at the first tab.
  expect(twelve.map((tab) => tab.divider)).toEqual([false, true, true, true, true, false, false, true, true, true, true, true])
  // Tabs touch: each starts where the one before it ends.
  for (let index = 1; index < twelve.length; index++) expect(twelve[index]!.rect[0]).toBeCloseTo(twelve[index - 1]!.rect[0]! + twelve[index - 1]!.rect[2]!, 1)
})
