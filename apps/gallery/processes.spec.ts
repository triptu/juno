import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

for (const theme of ['light', 'dark'] as const) {
  test(`ProcessesView states in ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/')
    const routes = (await readRoutes(page)).filter((route) => route.component === 'ProcessesView')
    expect(routes).toHaveLength(5)
    for (const route of routes) {
      await openState(page, route, theme)
      const frame = page.locator(`[data-fixture-frame="${route.route}"]`)
      await expect(frame.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible()
      await expect(frame.getByRole('button', { name: 'Show logs in Finder' })).toBeVisible()
      await expect(frame.locator('tbody tr')).toHaveCount(route.state === 'loading' ? 0 : 6)
      await testInfo.attach(`${route.state}-${theme}`, { body: await frame.screenshot(), contentType: 'image/png' })
    }
  })
}
