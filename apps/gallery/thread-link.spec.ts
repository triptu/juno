import { expect, test } from '@playwright/test'
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { openState, readRoutes } from './support'

test.use({ reducedMotion: 'no-preference' })

// Light only: a theme changes colours, never a size.
test('thread-link photos replace initials without moving the link', async ({ page }) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/__fixture/pending.png', async route => {
    await gate
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/></svg>' })
  })
  const routes = await readRoutes(page)
  const state = routes.find(route => route.route === 'ThreadLink/repliers/photo-pending')!
  await openState(page, state)
  const link = page.locator('[data-thread-link]')
  const avatars = link.locator('[data-kind="person"]')
  await expect(avatars).toHaveCount(3)
  await expect(avatars).toHaveText(['S', 'D', 'M'])
  const images = avatars.locator('img')
  const drawn = () => images.evaluateAll(nodes => nodes.every(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0))
  expect(await drawn()).toBe(false)
  const before = await link.boundingBox()
  await expectNoLayoutShift(page, async () => {
    release()
    await expect.poll(drawn).toBe(true)
  })
  expect(await link.boundingBox()).toEqual(before)
  for (const image of await images.all()) await expect(image).toHaveCSS('transition-duration', '0s')
})
