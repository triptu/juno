import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

for (const theme of ['light'] as const) {
  test(`Workspace follows the standard emoji categories in ${theme}`, async ({ page }) => {
    const route = (await readRoutes(page)).find((route) => route.component === 'EmojiPicker' && route.state === 'workspace')
    if (route === undefined) throw new Error('Workspace picker fixture is missing')
    await openState(page, route, theme)
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
}

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

test('Enter prefers the exact standard alias to a custom prefix', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').fill('thumbsup')
  await picker.getByRole('textbox').press('Enter')
  await expect(page.getByRole('status', { name: 'Picked emoji' })).toHaveText('+1')
  await picker.getByRole('textbox').fill('thumbsup')
  await expect(picker.locator('[data-emoji-results] [data-emoji]').first()).toHaveAttribute('data-emoji', '+1')
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

test('an alias saved in Settings marks its canonical emoji chosen in browse mode', async ({ page }) => {
  const picker = await regression(page)
  await expect(picker.getByRole('textbox')).toHaveValue('')
  await expect(picker.getByRole('group', { name: 'Frequently used' }).getByRole('button', { name: ':juno_wave:, added', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(picker.getByRole('group', { name: 'Frequently used' }).getByRole('button', { name: ':eyes:, added', exact: true })).toHaveAttribute('aria-disabled', 'true')
})


test('workspace aliases of standard emoji find their canonical glyph', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').fill('approval')
  // The alias is an exact name, so it leads keyword matches such as 👏.
  await expect(picker.locator('[data-emoji-results] [data-emoji]').first()).toHaveAttribute('data-emoji', '+1')
  await picker.getByRole('textbox').press('Enter')
  await expect(page.getByRole('status', { name: 'Picked emoji' })).toHaveText('+1')
  await expect(page.getByRole('status', { name: 'Picked glyph' })).toHaveText('👍')
})

test('an image with a standard name keeps a separate cell and picks the workspace name', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').fill('tada')
  const cells = picker.locator('[data-emoji="tada"]')
  await expect(cells).toHaveCount(2)
  await cells.filter({ has: page.locator('img') }).click()
  await expect(page.getByRole('status', { name: 'Picked emoji' })).toHaveText('tada')
  await expect(page.getByRole('status', { name: 'Picked glyph' })).toHaveText('')
})


test('picker search puts smile before substring matches', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').fill(':smi')
  await expect(picker.locator('[data-emoji-results] [data-emoji]').first()).toHaveAttribute('data-emoji', 'smile')
  await picker.getByRole('textbox').press('Enter')
  await expect(page.getByRole('status', { name: 'Picked glyph' })).toHaveText('😄')
})

test('chosen state distinguishes a standard glyph from a workspace image with the same name', async ({ page }) => {
  const picker = await regression(page)
  await picker.getByRole('textbox').fill('tada')
  const cells = picker.locator('[data-emoji="tada"]')
  await expect(cells.filter({ hasNot: page.locator('img') })).toHaveAttribute('aria-disabled', 'true')
  await expect(cells.filter({ has: page.locator('img') })).not.toHaveAttribute('aria-disabled', 'true')
})
