import { expect, type Page } from '@playwright/test'
import { ownPageTest, test } from './support'

/**
 * The tooltip (primitives, Tooltip) in a real browser: the hover delay and
 * the warm window, hiding on mouse down and Esc, keyboard focus, no layout
 * movement, and staying inside the frame at every edge.
 */
const tip = (page: Page) => page.getByRole('tooltip')
const BACK = 'Back ⌘['
const FORWARD = 'Forward ⌘]'

async function centre(page: Page, name: string) {
  const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function openToolbar(page: Page) {
  await page.goto('/#/Tooltip?__state=toolbar/back')
  await expect(page.getByRole('button', { name: BACK })).toBeVisible()
}

// The clock stays on the context, so this test has its own.
ownPageTest('tooltip delay, warm navigation, keyboard focus and dismissal preserve the controls', async ({ page }) => {
  await openToolbar(page)
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  const buttons = page.locator('[data-fixture-frame] button')
  const boxes = () => buttons.evaluateAll(all => all.map(button => button.getBoundingClientRect().toJSON()))
  const before = await boxes()
  const back = await centre(page, BACK)
  await page.mouse.move(back.x, back.y)
  await page.clock.runFor(400)
  await expect(tip(page)).toHaveCount(0)
  await page.clock.runFor(400)
  await expect(tip(page)).toHaveText('Back⌘[')
  await expect(tip(page).locator('kbd')).toHaveText(['⌘', '['])
  expect(await boxes()).toEqual(before)
  const box = (await tip(page).boundingBox())!
  const control = (await page.getByRole('button', { name: BACK }).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(control.y + control.height)

  const forward = await centre(page, FORWARD)
  await page.mouse.move(forward.x, forward.y)
  await expect(tip(page)).toHaveText('Forward⌘]')
  await page.keyboard.press('Escape')
  await expect(tip(page)).toHaveCount(0)
  await page.mouse.move(0, 0)
  await page.getByRole('button', { name: BACK }).focus()
  await page.keyboard.press('Tab')
  await page.clock.runFor(400)
  await expect(tip(page)).toHaveCount(0)
  await page.clock.runFor(400)
  await expect(tip(page)).toHaveText('Forward⌘]')
  await page.mouse.move(forward.x, forward.y)
  await page.mouse.down()
  await expect(tip(page)).toHaveCount(0)
  await page.mouse.up()
  await page.mouse.move(forward.x + 2, forward.y + 2)
  await page.clock.runFor(1000)
  await expect(tip(page)).toHaveCount(0)
})

test('a tooltip stays inside the frame next to every edge', async ({ page }) => {
  await page.goto('/#/Tooltip?__state=edges/corners')
  const frame = (await page.locator('[data-fixture-frame]').boundingBox())!
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const button = page.locator(`[data-corner="${corner}"]`)
    const control = (await button.boundingBox())!
    // Geometry is the same for cold and warm tooltips; the flow above checks the delay.
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
    await button.hover()
    await expect(tip(page)).toBeVisible()
    const box = (await tip(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(frame.x)
    expect(box.y).toBeGreaterThanOrEqual(frame.y)
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width)
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height)
    // Over or under the control, never on it.
    expect(box.y >= control.y + control.height || box.y + box.height <= control.y).toBe(true)
  }
})
