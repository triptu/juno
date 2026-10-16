// Enter while a file is staging (spec section 8): the topic composer sends
// at once, the message shows as sending, and it goes when the file is
// ready; a file that cannot be read makes the message "Not sent.".
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { brief, chart, chip, chips, paste } from './attach'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'

/** Holds the next file read until `release-file-read`, as when the file is on a slow volume. With `fail`, the read then fails. */
function holdFileRead(win: Page, { fail = false }: { readonly fail?: boolean } = {}) {
  return win.evaluate((fail) => {
    const slice = File.prototype.slice
    File.prototype.slice = function (...args) {
      File.prototype.slice = slice
      const blob = slice.apply(this, args)
      const read = blob.arrayBuffer.bind(blob)
      blob.arrayBuffer = () => new Promise<ArrayBuffer>((resolve, reject) => {
        window.addEventListener('release-file-read', () => (fail ? reject(new DOMException('The file could not be read.', 'NotReadableError')) : void read().then(resolve)), { once: true })
      })
      return blob
    }
  }, fail)
}

const releaseFileRead = (win: Page) => win.evaluate(() => window.dispatchEvent(new Event('release-file-read')))

test('Enter while a file is still being read sends at once, and the message goes when the file is ready', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await holdFileRead(win)
  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await topic.send('Chart while it loads')
  // The composer empties and the message shows as sending, with its file, before the file is read.
  await expect(topic.composer).toHaveValue('')
  await expect(chips(topic)).toHaveCount(0)
  await expect(topic.message('Chart while it loads')).toHaveAttribute('data-pending', 'sending')
  await expect(topic.message('Chart while it loads')).toContainText('chart.png')
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL' || call.method === 'files.share')).toEqual([])

  await releaseFileRead(win)
  await topic.expectSent('Chart while it loads')
  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['chart.png'])
  await expect(topic.message('Chart while it loads').getByRole('button', { name: 'Open chart.png' })).toBeVisible()
})

test('a file that cannot be read after Enter shows its message as not sent', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await holdFileRead(win, { fail: true })
  await paste(topic.composer, [brief()])
  await expect(chip(topic, 'launch-brief.pdf')).toBeVisible()
  await topic.send('Brief that will not load')
  await expect(topic.message('Brief that will not load')).toHaveAttribute('data-pending', 'sending')

  await releaseFileRead(win)
  const failed = topic.failed('Brief that will not load')
  await expect(failed.row).toContainText('Not sent.', { timeout: 15_000 })
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL' || call.method === 'files.share' || call.method === 'chat.postMessage')).toEqual([])
  // Nothing new can come of a retry: Delete draft takes the row away.
  await failed.discard()
  await expect(topic.message('Brief that will not load')).toHaveCount(0)
})

test('a choice on the send check bar sends while a newly attached file is still being read', async ({ juno, win, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  // Wrong place is the one check before sending: wait for the typing pause's answer.
  const since = Date.now()
  await topic.composer.fill(BILL_REPLY)
  await expect.poll(() => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
    try {
      return (db.prepare(`SELECT max(CAST(created_at AS INTEGER)) AS at FROM ai_cache WHERE task = 'routeCheck' AND model != ''`).get() as { at: number | null }).at ?? 0
    } finally {
      db.close()
    }
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(since)
  await topic.composer.press('Enter')
  const post = topic.root.getByRole('button', { name: /Post in thread/ })
  await expect(post).toBeVisible()

  await holdFileRead(win)
  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await post.click()
  await expect(topic.composer).toHaveValue('')
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage' || call.method === 'files.share')).toHaveLength(0)

  await releaseFileRead(win)
  await expect.poll(() => fake.calls.filter((call) => call.method === 'files.share').length, { timeout: 15_000 }).toBe(1)
  expect(fake.calls.find((call) => call.method === 'files.share')!.args['thread_ts']).toBeDefined()
})
