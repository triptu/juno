import { expect, test } from '@playwright/test'

// In light only: the dark theme changes colours and shadows, never a size (packages/tokens/src/themes.stylex.ts).
test('attachment image reserves its box before a late image arrives', async ({ page }) => {
  await page.goto('/#/AttachmentCard?__state=image')
  const frame = page.locator('[data-fixture-frame]')
  const image = frame.getByRole('img', { name: 'Synthetic latency chart' })
  await expect(image).toBeVisible()
  const before = await frame.boundingBox()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('https://example.test/late-chart.svg', async (route) => {
    await gate
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="800"><rect width="40" height="800" fill="gray"/></svg>' })
  })
  await image.evaluate((element: HTMLImageElement) => { element.src = 'https://example.test/late-chart.svg' })
  expect(await frame.boundingBox()).toEqual(before)
  release()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalHeight === 800)).toBe(true)
  expect(await frame.boundingBox()).toEqual(before)
  const box = await image.boundingBox()
  expect(box!.width).toBe(360)
  expect(box!.height).toBe(240)
})

test('failed unfurl image leaves only readable content', async ({ page }) => {
  await page.goto('/#/AttachmentCard?__state=failed-image')
  const card = page.getByRole('region', { name: 'Attachment' })
  await expect(card).toContainText('Small experiments make the next decision clearer.')
  await expect(card.getByRole('img', { name: 'Unavailable preview' })).toHaveCount(0)
  expect((await card.boundingBox())!.height).toBeLessThan(200)
})
