import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The tab strip's close buttons (inventory 4, decided 10-17): never a Tab
 * stop, never inside the `tab` element, named by the tab as its action, and
 * drawn where they were, 7px from the tab's end.
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
        end: button === null ? null : Math.round(tab.getBoundingClientRect().right - button.getBoundingClientRect().right),
      }
    }),
  )
  const closable = tabs.filter((tab) => tab.hasAction)
  expect(closable.length).toBeGreaterThan(1)
  for (const tab of tabs) expect(tab.nested).toBe(false)
  for (const tab of closable) expect(tab).toMatchObject({ sibling: true, tabStop: false, end: 7 })
})

test('Tab from the active tab goes to "+", past every close button', async ({ page }) => {
  await open(page, 'Tabs', 'strip/many')
  await page.locator('[role="tab"][aria-selected="true"]').focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/^New (chat|tab)/)
})
