import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { unfurlFixtures } from '@juno/fake-slack'
import { expect, launchApp, syncedTest, test } from './fixtures'
import { Juno } from './driver/juno'

/** Some photo under `scope` has loaded its bytes. */
const expectPhotoLoaded = (scope: Locator) =>
  expect.poll(() => scope.locator('img[src^="juno://files/avatar"]').evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)

test('photos load in messages and sidebar stacks and unfurls keep text when images fail', async ({ juno, fake, win }) => {
  const fixtures = unfurlFixtures(fake.credentials().url)
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Preview setup', silent: true })
  for (const [name, attachment] of Object.entries(fixtures)) {
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `Preview ${name}`, attachments: [attachment], silent: true })
  }
  await juno.signIn()
  await juno.waitForSync()
  // The sidebar's people are the senders of unread messages, so check them before opening marks #eng read.
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Unread from Leo' })
  const stack = juno.sidebar.row('#eng').root.locator('img[src^="juno://files/avatar"]')
  await expect.poll(() => stack.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
  await juno.sidebar.row('#eng').open()
  const row = juno.topic.message('Preview xImage')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toContainText('Small experiments make the next decision clearer.')
  await expect(row).toContainText('Avery Example (@avery_example)')
  const photo = row.locator('img[src^="juno://files/avatar"]')
  await expect.poll(() => photo.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
  await expect(photo).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-72$/)
  const previewImage = row.getByRole('img', { name: 'Avery Example on X' })
  await expect.poll(() => previewImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const failed = juno.topic.message('Preview failed')
  await failed.scrollIntoViewIfNeeded()
  await expect(failed).toContainText('The description remains readable.')
  await expect(failed.locator('section[aria-label="Attachment"] img')).toHaveCount(0)
  await expect(juno.topic.message('Preview xText')).toContainText('A text-only update from the test workspace.')
  // A shared message's words come as blocks and as text; they show once.
  const shared = juno.topic.message('Preview shared')
  await shared.scrollIntoViewIfNeeded()
  await expect(shared.locator('[data-shared-source]')).toHaveText('eng')
  expect(((await shared.textContent()) ?? '').split('Shared words appear once.').length - 1).toBe(1)
  await juno.accountMenu.open()
  const accountPhoto = juno.accountMenu.root.locator('img[src^="juno://files/avatar"]')
  await expect.poll(() => accountPhoto.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.naturalWidth > 0))).toBe(true)
  await juno.accountMenu.close()
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

// Live, the edge `users/info` and `client.userBoot` carry no `image_*` urls,
// only `avatar_hash`; the fake answers the same way.
test('photos built from the avatar hash load in a message row, a DM row and the account menu', async ({ juno, fake }) => {
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Photo from a custom image', silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Photo from the default image', silent: true })
  await juno.signIn()
  await juno.waitForSync()

  const dm = juno.sidebar.row('Maya', { exact: true }).root
  await expect(dm.locator('img[src^="juno://files/avatar"]')).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-192$/)
  await expectPhotoLoaded(dm)

  await juno.sidebar.row('#eng').open()
  for (const [text, user] of [['Photo from a custom image', 'U0MAYA'], ['Photo from the default image', 'U0LEO']] as const) {
    const row = juno.topic.message(text)
    await row.scrollIntoViewIfNeeded()
    await expect(row.locator('img[src^="juno://files/avatar"]')).toHaveAttribute('src', new RegExp(`T0JUNO-${user}-fake${user.toLowerCase()}-72$`))
    await expectPhotoLoaded(row)
  }

  await juno.accountMenu.open()
  await expectPhotoLoaded(juno.accountMenu.root)
  await juno.accountMenu.close()
})

syncedTest('users stored without a photo get one on the next launch, with no re-sync', async ({ juno, fake, slackApp, userData, running }) => {
  await running.close()
  // As a cache written before photos were built from the avatar hash.
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'))
  db.prepare('UPDATE users SET avatar_url = NULL, avatar_small_url = NULL, avatar_large_url = NULL').run()
  db.prepare(`INSERT INTO sync_state (key, value_json) VALUES ('e2e_kept', 'true')`).run()
  db.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const relaunched = new Juno(again.app, again.win)
    const dm = relaunched.sidebar.row('Maya', { exact: true }).root
    await expect(dm.locator('img[src^="juno://files/avatar"]')).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-192$/, { timeout: 30_000 })
    await expectPhotoLoaded(dm)
    await relaunched.accountMenu.open()
    await expectPhotoLoaded(relaunched.accountMenu.root)
    await relaunched.accountMenu.close()
  } finally {
    await again.close()
  }
  const after = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'))
  // The cache file was kept, not deleted and synced again.
  expect(after.prepare(`SELECT value_json FROM sync_state WHERE key = 'e2e_kept'`).get()).toEqual({ value_json: 'true' })
  after.close()
})
