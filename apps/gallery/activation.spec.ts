import { expect, test, type Page } from '@playwright/test'

/**
 * Mouse-down activation (`activateHandlers`, performance.md 4.1), checked on
 * the `ListRow/activation` fixture in a real browser.
 */
const log = (page: Page) => page.locator('[data-activation-log]')

test.describe('mouse-down activation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ListRow?__state=activation/activation')
    await expect(page.getByRole('button', { name: /Postgres 16 migration plan/ })).toBeVisible()
  })

  test('activates on the primary button going down, before the click', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    const box = (await row.boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await expect(log(page)).toHaveText('row:pointer')
    await page.mouse.up()
    // The click that follows the release does not activate again.
    await expect(log(page)).toHaveText('row:pointer')
  })

  test('passes the command key through for open in new tab', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    await row.click({ modifiers: ['Meta'] })
    await expect(log(page)).toHaveText('row:pointer:meta')
  })

  test('ignores ctrl-click and the secondary button', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    // On macOS Chromium turns ctrl-click into a context menu, like the OS.
    await row.click({ modifiers: ['Control'] })
    await row.click({ button: 'right' })
    await expect(log(page)).toContainText('row:contextmenu')
    await expect(log(page)).not.toContainText('row:pointer')
  })

  test('leaves a press on a nested control to that control', async ({ page }) => {
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(log(page)).toHaveText('resolve:click')
  })

  test('activates from the keyboard with Enter', async ({ page }) => {
    await page.getByRole('button', { name: /Postgres 16 migration plan/ }).focus()
    await page.keyboard.press('Enter')
    await expect(log(page)).toHaveText('row:keyboard')
  })

  test('activates once when Enter is held', async ({ page }) => {
    await page.getByRole('button', { name: /Postgres 16 migration plan/ }).focus()
    // A second down without an up is sent with `repeat`, like auto-repeat.
    await page.keyboard.down('Enter')
    await page.keyboard.down('Enter')
    await page.keyboard.down('Enter')
    await page.keyboard.up('Enter')
    await expect(log(page)).toHaveText('row:keyboard')
  })

  test('leaves a press inside data-no-activate alone', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    const title = page.getByText('Postgres 16 migration plan')
    await title.evaluate((node) => node.setAttribute('data-no-activate', ''))
    await title.click()
    // Enter afterwards shows the log is live: its entry is the only one.
    await row.press('Enter')
    await expect(log(page)).toHaveText('row:keyboard')
  })

  test('ignores a pointer that is not the primary one', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    await row.evaluate((node) => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'pen', isPrimary: false }))
    })
    await row.press('Enter')
    await expect(log(page)).toHaveText('row:keyboard')
  })
})
