import { expect, test, type Page } from '@playwright/test'

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

/** Rests the pointer on Back and waits for its tooltip. */
async function hoverBack(page: Page) {
  const back = await centre(page, BACK)
  await page.mouse.move(back.x, back.y)
  await expect(tip(page)).toBeVisible()
  return back
}

test('a tooltip shows after the hover delay with its shortcut as keycaps, then a neighbour at once', async ({ page }) => {
  await openToolbar(page)
  const back = await centre(page, BACK)
  await page.mouse.move(back.x, back.y)
  await page.waitForTimeout(400)
  await expect(tip(page)).toHaveCount(0)
  await expect(tip(page)).toHaveText('Back⌘[')
  await expect(tip(page).locator('kbd')).toHaveText(['⌘', '['])
  const id = await tip(page).getAttribute('id')
  await expect(page.getByRole('button', { name: BACK })).toHaveAttribute('aria-describedby', id!)

  // Warm: the next control's shows well inside the delay.
  const forward = await centre(page, FORWARD)
  await page.mouse.move(forward.x, forward.y)
  await expect(tip(page)).toHaveText('Forward⌘]', { timeout: 300 })
  await expect(page.getByRole('button', { name: BACK })).not.toHaveAttribute('aria-describedby')
})

test('a tooltip hides on mouse down and stays hidden over the same control', async ({ page }) => {
  await openToolbar(page)
  const back = await hoverBack(page)
  await page.mouse.down()
  await expect(tip(page)).toHaveCount(0)
  await page.mouse.up()
  await page.mouse.move(back.x + 2, back.y + 2)
  await page.waitForTimeout(1000)
  await expect(tip(page)).toHaveCount(0)
})

test('a tooltip hides on Escape', async ({ page }) => {
  await openToolbar(page)
  await hoverBack(page)
  await page.keyboard.press('Escape')
  await expect(tip(page)).toHaveCount(0)
})

test('a tooltip shows on keyboard focus after the same delay', async ({ page }) => {
  await openToolbar(page)
  await page.getByRole('button', { name: BACK }).focus()
  // From the keyboard, so :focus-visible matches.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await expect(tip(page)).toHaveCount(0)
  await expect(tip(page)).toHaveText('Forward⌘]')
})

test('a tooltip moves nothing and sits under its control without covering it', async ({ page }) => {
  await openToolbar(page)
  const buttons = page.locator('[data-fixture-frame] button')
  const boxes = () => buttons.evaluateAll((all) => all.map((b) => b.getBoundingClientRect().toJSON() as unknown))
  const before = await boxes()
  await hoverBack(page)
  expect(await boxes()).toEqual(before)
  await expect(tip(page)).toHaveCSS('position', 'fixed')
  const box = (await tip(page).boundingBox())!
  const control = (await page.getByRole('button', { name: BACK }).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(control.y + control.height)
})

test('a tooltip stays inside the frame next to every edge', async ({ page }) => {
  await page.goto('/#/Tooltip?__state=edges/corners')
  const frame = (await page.locator('[data-fixture-frame]').boundingBox())!
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const button = page.locator(`[data-corner="${corner}"]`)
    const control = (await button.boundingBox())!
    // Off the controls first, past the warm window, so each one waits out the delay on its own.
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
    await page.waitForTimeout(800)
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
