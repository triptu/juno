import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * A message under the pointer (inventory 6.1): a quiet fill of its own,
 * `--message-hover`, and the arrow cursor over its text, which stays
 * selectable. Only editable text shows the text cursor (SPEC 16).
 */

const open = (page: Page, theme: 'light' | 'dark' = 'light') =>
  openState(page, { component: 'Shell', id: 'interaction/hover-message', route: 'Shell/interaction/hover-message', group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

const row = (page: Page) => page.locator('[data-message-row]').nth(2)

for (const theme of ['light', 'dark'] as const) {
  test(`a hovered message takes the message hover fill, in ${theme}`, async ({ page }) => {
    await open(page, theme)
    await row(page).locator('[data-msg-text]').first().hover()
    const fill = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--message-hover)'
      document.body.append(probe)
      const value = getComputedStyle(probe).backgroundColor
      probe.remove()
      return value
    })
    await expect(row(page)).toHaveCSS('background-color', fill)
  })
}

test('the pointer stays the arrow over message text, and the text stays selectable', async ({ page }) => {
  await open(page)
  const text = row(page).locator('[data-msg-text]').first()
  await text.hover()
  await expect(text).toHaveCSS('cursor', 'default')
  await expect(text).toHaveCSS('user-select', 'text')
  const code = page.locator('[data-message-row] pre').first()
  await expect(code).toHaveCSS('cursor', 'default')
  await expect(code).toHaveCSS('user-select', 'text')

  // A drag across the text still selects it, and the selection stays for copy.
  const box = (await text.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 })
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString().length ?? 0)).toBeGreaterThan(10)
  await page.mouse.up()
  expect(await page.evaluate(() => document.getSelection()?.toString().length ?? 0)).toBeGreaterThan(10)
})
