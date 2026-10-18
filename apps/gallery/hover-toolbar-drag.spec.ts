import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * A drag selection keeps the message hover toolbar out of the way, as
 * native apps keep hover controls out of a selection: from the moment a
 * press on a message moves until the button is up, no row shows its
 * toolbar. On release the row under the pointer shows it again.
 */

const open = (page: Page, id: string) =>
  openState(page, { component: 'MessageList', id, route: `MessageList/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

const visibleToolbars = (page: Page) => page.locator('[data-fixture-frame] [data-message-row] [role="toolbar"]:visible')

test('a drag selection hides the hover toolbar until the button is up, then the row under the pointer shows it', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-under-band')
  const texts = page.locator('[data-fixture-frame] [data-msg-text]')
  const from = (await texts.nth(1).boundingBox())!
  const to = (await texts.nth(2).boundingBox())!
  await page.mouse.move(from.x + 4, from.y + from.height / 2)
  await expect(visibleToolbars(page)).toHaveCount(1)

  await page.mouse.down()
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 8 })
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString().length ?? 0)).toBeGreaterThan(0)
  await expect(visibleToolbars(page)).toHaveCount(0)

  await page.mouse.up()
  await expect(visibleToolbars(page)).toHaveCount(1)
  const row = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-message-row]') as HTMLElement | null)?.dataset['messageRow'], { x: to.x + 40, y: to.y + to.height / 2 })
  await expect(page.locator(`[data-fixture-frame] [data-message-row="${row}"] [role="toolbar"]`)).toBeVisible()
})

test('a press that does not move keeps the hover toolbar', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-under-band')
  const text = (await page.locator('[data-fixture-frame] [data-msg-text]').nth(1).boundingBox())!
  await page.mouse.move(text.x + 4, text.y + text.height / 2)
  await page.mouse.down()
  await expect(visibleToolbars(page)).toHaveCount(1)
  await page.mouse.up()
  await expect(visibleToolbars(page)).toHaveCount(1)
})
