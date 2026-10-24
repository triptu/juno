import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

test('Workspace follows the standard emoji categories', async ({ page }) => {
  const route = (await readRoutes(page)).find((route) => route.component === 'EmojiPicker' && route.state === 'workspace')
  if (route === undefined) throw new Error('Workspace picker fixture is missing')
  await openState(page, route)
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  const groups = picker.getByRole('group')
  await expect(groups.last()).toHaveAccessibleName('Workspace')
  await expect(groups.first()).not.toHaveAccessibleName('Workspace')
  // Offscreen workspace rows do not mount or start loading images when the picker opens.
  await expect(picker.locator('[data-emoji="juno_wave"]')).toHaveCount(0)
  await groups.last().evaluate((node) => node.scrollIntoView({ block: 'start' }))
  const images = groups.last().locator('img')
  await expect(images).toHaveCount(8)
  await expect.poll(() => images.evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  await expect(groups.last().locator('[data-emoji="hello_juno"]')).toHaveCount(0)
})

async function regression(page: import('@playwright/test').Page) {
  const route = (await readRoutes(page)).find((route) => route.component === 'EmojiPicker' && route.state === 'regression')
  if (route === undefined) throw new Error('Regression picker fixture is missing')
  await openState(page, route)
  return page.getByRole('dialog', { name: 'Emoji' })
}

test('focused emoji survives wheel scrolling, arrows still move and Escape dismisses', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').press('ArrowDown')
  const focused = picker.locator('[data-emoji]:focus')
  const name = await focused.getAttribute('data-emoji')
  await picker.locator('[data-scroll-area]').hover()
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => picker.locator('[data-scroll-area]').evaluate((node) => node.scrollTop)).toBeGreaterThan(1000)
  await expect(picker.locator(`[data-emoji="${name}"]`).first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(picker.locator('[data-emoji="eyes"]').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
})

test('failed images retain their cell and do not move later emoji', async ({ page }) => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/broken-emoji.svg', async (route) => { await held; await route.fulfill({ status: 404, body: '' }) })
  const picker = await regression(page)
  await picker.getByRole('textbox').fill('broken_')
  const cell = picker.locator('[data-emoji="broken_image"]')
  await expect(cell).toBeVisible()
  const before = await cell.boundingBox()
  const neighbour = picker.locator('[data-emoji="broken_neighbor"]')
  const neighbourBefore = await neighbour.boundingBox()
  release()
  await expect(cell.locator('[data-emoji-placeholder]')).toBeVisible()
  await expect(cell).toHaveText('')
  await expect(cell).toHaveAccessibleName(':broken_image:')
  await expect(cell).toHaveAttribute('title', ':broken_image:')
  expect(await cell.boundingBox()).toEqual(before)
  expect(await neighbour.boundingBox()).toEqual(neighbourBefore)
})

/**
 * One open picker, searched several times as a person would. The steps pick
 * a different emoji each time, so each pick's check sees a new value.
 */
test('search finds the right emoji, marks the chosen ones and picks what was asked for', async ({ page }) => {
  const picker = await regression(page)
  const field = picker.getByRole('textbox')
  const first = picker.locator('[data-emoji-results] [data-emoji]').first()
  const picked = page.getByRole('status', { name: 'Picked emoji' })
  const glyph = page.getByRole('status', { name: 'Picked glyph' })

  await test.step('an alias saved in Settings marks its canonical emoji chosen in browse mode', async () => {
    await expect(field).toHaveValue('')
    const frequent = picker.getByRole('group', { name: 'Frequently used' })
    await expect(frequent.getByRole('button', { name: ':juno_wave:, added', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(frequent.getByRole('button', { name: ':eyes:, added', exact: true })).toHaveAttribute('aria-disabled', 'true')
  })

  await test.step('search puts smile before substring matches', async () => {
    await field.fill(':smi')
    await expect(first).toHaveAttribute('data-emoji', 'smile')
    await field.press('Enter')
    await expect(glyph).toHaveText('😄')
  })

  await test.step('Enter prefers the exact standard alias to a custom prefix', async () => {
    await field.fill('thumbsup')
    await field.press('Enter')
    await expect(picked).toHaveText('+1')
    await field.fill('thumbsup')
    await expect(first).toHaveAttribute('data-emoji', '+1')
  })

  await test.step('an image with a standard name keeps a separate cell, chosen apart from the glyph, and picks the workspace name', async () => {
    await field.fill('tada')
    const cells = picker.locator('[data-emoji="tada"]')
    await expect(cells).toHaveCount(2)
    await expect(cells.filter({ hasNot: page.locator('img') })).toHaveAttribute('aria-disabled', 'true')
    await expect(cells.filter({ has: page.locator('img') })).not.toHaveAttribute('aria-disabled', 'true')
    await cells.filter({ has: page.locator('img') }).click()
    await expect(picked).toHaveText('tada')
    await expect(glyph).toHaveText('')
  })

  await test.step('a workspace alias of a standard emoji finds its canonical glyph', async () => {
    await field.fill('approval')
    // The alias is an exact name, so it leads keyword matches such as 👏.
    await expect(first).toHaveAttribute('data-emoji', '+1')
    await field.press('Enter')
    await expect(picked).toHaveText('+1')
    await expect(glyph).toHaveText('👍')
  })
})
