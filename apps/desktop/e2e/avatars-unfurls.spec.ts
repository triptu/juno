import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { unfurlFixtures } from '@juno/fake-slack'
import { expect, syncedTest, test } from './fixtures'
import { schemeSrc } from './driver/juno'

/** Some photo under `scope` has loaded its bytes. */
const expectPhotoLoaded = (scope: Locator) =>
  expect.poll(() => scope.locator(`img${schemeSrc('files')}[src*="/avatar"]`).evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)

// Live, the edge `users/info` and `client.userBoot` carry no `image_*` urls,
// only `avatar_hash`; the fake answers the same way, so every photo here is built from the hash.
test('photos load in messages, sidebar stacks, a DM row and the account menu, and unfurls keep text when images fail', async ({ juno, fake }) => {
  const fixtures = unfurlFixtures(fake.credentials().url)
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Preview setup', silent: true })
  for (const [name, attachment] of Object.entries(fixtures)) {
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `Preview ${name}`, attachments: [attachment], silent: true })
  }
  await juno.signIn()
  await juno.waitForSync()
  // The sidebar's people are the senders of unread messages, so check them before opening marks #eng read.
  fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Unread from Leo' })
  const stack = juno.sidebar.row('#eng').root.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
  await expect.poll(() => stack.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true)
  const dm = juno.sidebar.row('Maya', { exact: true }).root
  await expect(dm.locator(`img${schemeSrc('files')}[src*="/avatar"]`)).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-192$/)
  await expectPhotoLoaded(dm)
  await juno.sidebar.row('#eng').open()
  // A person with the default image, as well as Maya's custom one below.
  const leo = juno.topic.message('Unread from Leo')
  await leo.scrollIntoViewIfNeeded()
  await expect(leo.locator(`img${schemeSrc('files')}[src*="/avatar"]`)).toHaveAttribute('src', /T0JUNO-U0LEO-fakeu0leo-72$/)
  await expectPhotoLoaded(leo)
  const row = juno.topic.message('Preview xImage')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toContainText('Small experiments make the next decision clearer.')
  await expect(row).toContainText('Avery Example (@avery_example)')
  const photo = row.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
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
  const accountPhoto = juno.accountMenu.root.locator(`img${schemeSrc('files')}[src*="/avatar"]`)
  await expect.poll(() => accountPhoto.evaluateAll((images) => images.some((img) => img instanceof HTMLImageElement && img.naturalWidth > 0))).toBe(true)
  await juno.accountMenu.close()
})

syncedTest('users stored without a photo get one on the next launch, with no re-sync', async ({ fake, userData, relaunch }) => {
  const relaunched = await relaunch({ whileClosed: () => {
    // A cache written before photos were built from the avatar hash.
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'))
    db.prepare('UPDATE users SET avatar_url = NULL, avatar_small_url = NULL, avatar_large_url = NULL').run()
    db.prepare(`INSERT INTO sync_state (key, value_json) VALUES ('e2e_kept', 'true')`).run()
    db.close()
  } })
  const dm = relaunched.sidebar.row('Maya', { exact: true }).root
  await expect(dm.locator(`img${schemeSrc('files')}[src*="/avatar"]`)).toHaveAttribute('src', /T0JUNO-U0MAYA-fakeu0maya-192$/, { timeout: 30_000 })
  await expectPhotoLoaded(dm)
  await relaunched.accountMenu.open()
  await expectPhotoLoaded(relaunched.accountMenu.root)
  await relaunched.accountMenu.close()
  const after = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'))
  // The cache file was kept, not deleted and synced again.
  expect(after.prepare(`SELECT value_json FROM sync_state WHERE key = 'e2e_kept'`).get()).toEqual({ value_json: 'true' })
  after.close()
})
