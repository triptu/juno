import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

for (const theme of ['light', 'dark'] as const) {
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
    const path = test.info().outputPath(`workspace-${theme}.png`)
    await picker.screenshot({ path })
    await test.info().attach(`Workspace ${theme}`, { path, contentType: 'image/png' })
  })
}
