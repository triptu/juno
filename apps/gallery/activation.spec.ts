import { expect, type Page } from '@playwright/test'
import { test } from './support'

const log = (page: Page) => page.locator('[data-activation-log]')
const row = (page: Page) => page.getByRole('button', { name: /Postgres 16 migration plan/ })

test.beforeEach(async ({ page }) => {
  await page.goto('/#/ListRow?__state=activation/activation')
  await expect(row(page)).toBeVisible()
})

test('navigation activates on mouse down exactly once and preserves Command', async ({ page }) => {
  const box = (await row(page).boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await expect(log(page)).toHaveText('row:pointer')
  await page.mouse.up()
  await expect(log(page)).toHaveText('row:pointer')
  await row(page).click({ modifiers: ['Meta'] })
  await expect(log(page)).toHaveText('row:pointer row:pointer:meta')
})

test('context menus and nested controls do not activate the row', async ({ page }) => {
  await row(page).click({ modifiers: ['Control'] })
  await row(page).click({ button: 'right' })
  await expect(log(page)).toContainText('row:contextmenu')
  await expect(log(page)).not.toContainText('row:pointer')
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(log(page)).toContainText('resolve:click')
  const before = await log(page).textContent()
  const title = page.getByText('Postgres 16 migration plan')
  await title.evaluate(node => node.setAttribute('data-no-activate', ''))
  await title.click()
  await row(page).evaluate(node => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'pen', isPrimary: false })))
  await expect(log(page)).toHaveText(before ?? '')
})

test('holding Enter activates once; a later Enter activates again', async ({ page }) => {
  await row(page).focus()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect(log(page)).toHaveText('row:keyboard')
  await page.keyboard.press('Enter')
  await expect(log(page)).toHaveText('row:keyboard row:keyboard')
})
