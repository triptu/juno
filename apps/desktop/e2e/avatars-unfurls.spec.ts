import { unfurlFixtures } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test('photos load in messages and sidebar stacks and unfurls keep text when images fail', async ({ juno, fake, win }) => {
  const fixtures = unfurlFixtures(fake.credentials().url)
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Preview setup', silent: true })
  for (const [name, attachment] of Object.entries(fixtures)) {
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `Preview ${name}`, attachments: [attachment], silent: true })
  }
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  const row = juno.topic.message('Preview xImage')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toContainText('Small experiments make the next decision clearer.')
  await expect(row).toContainText('Avery Example (@avery_example)')
  const photo = row.locator('img[src^="juno://files/avatar"]')
  await expect.poll(() => photo.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
  const stack = win.locator('aside[aria-label="Sidebar"] img[src^="juno://files/avatar"]')
  await expect.poll(() => stack.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
  await expect(photo).toHaveAttribute('src', /size%3D72/)
  const previewImage = row.getByRole('img', { name: 'Avery Example on X' })
  await expect.poll(() => previewImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const failed = juno.topic.message('Preview failed')
  await failed.scrollIntoViewIfNeeded()
  await expect(failed).toContainText('The description remains readable.')
  await expect(failed.locator('section[aria-label="Attachment"] img')).toHaveCount(0)
  await expect(juno.topic.message('Preview xText')).toContainText('A text-only update from the test workspace.')
  const policy = await win.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("img-src 'self' juno: https://*.slack-edge.com https://secure.gravatar.com data:")
  expect(policy).not.toContain('slack-imgs.com')
  expect(policy).not.toContain('twimg.com')
})


test('the image route refuses local addresses and non-image responses', async ({ juno, fake, app }) => {
  await juno.signIn()
  const urls = ['https://127.0.0.1/image.png', 'https://[::1]/image.png', 'file:///tmp/image.png', `${fake.url}/health`]
  for (const url of urls) {
    const status = await app.evaluate(async ({ net }, source) => {
      const response = await net.fetch(`juno://images/?url=${encodeURIComponent(source)}`)
      return response.status
    }, url)
    expect(status).toBe(404)
  }
})
