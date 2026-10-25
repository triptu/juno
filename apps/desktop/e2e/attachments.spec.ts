// Attachments (spec section 8; architecture 9) where the browser matters:
// images at their final size, the local copy before Slack's thumbnails, and a
// download into Downloads. Paste, drop, the picker, a failed upload's Retry,
// unreadable files and the viewer are in the DOM lane
// (`dom/attachments.test.ts`).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schemeSrc } from './driver/juno'
import { expect, test } from './fixtures'
import { chart, chip, chips, paste, staged } from './attach'
import { expectStableAnchor } from './shiftProbe'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const PROPOSAL = 'Proposal: cut offline mode'

test('a pasted image goes with the message and shows in it at its final size', { tag: '@canary' }, async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await expect(topic.root.locator(`[data-composer] img${schemeSrc('uploads')}`)).toHaveCount(1)

  fake.holdNext({ method: 'files.share', before: true })
  await topic.send('The chart for Thursday')
  await expect(chips(topic)).toHaveCount(0)
  const row = topic.message('The chart for Thursday')
  await expect(row).toHaveAttribute('data-pending', 'sending')
  const pending = row.getByRole('img', { name: 'chart.png' }).or(row.getByRole('button', { name: 'Open chart.png' }))
  await expect(pending).toBeVisible()
  const box = await pending.boundingBox()
  expect({ width: box!.width, height: box!.height }).toEqual({ width: 360, height: 225 })

  fake.release()
  await topic.expectSent('The chart for Thursday')
  await expect(row.getByRole('button', { name: 'Open chart.png' }).locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
  const settled = await row.getByRole('button', { name: 'Open chart.png' }).boundingBox()
  expect({ width: settled!.width, height: settled!.height }).toEqual({ width: 360, height: 225 })

  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  const posted = fake.messages('C0ENG').filter((m) => m.client_msg_id === shares[0]!.args['client_msg_id'])
  expect(posted.map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png']])
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toEqual([])

  // Another person's 800 × 600 image shows at its own final size.
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Whiteboard from today', media: [{ name: 'whiteboard.png', width: 800, height: 600 }] })
  const whiteboard = topic.message('Whiteboard from today').getByRole('button', { name: 'Open whiteboard.png' })
  await expect(whiteboard.locator(`img${schemeSrc('files')}`)).toHaveCount(1)
  expect(await whiteboard.boundingBox()).toMatchObject({ width: 320, height: 240 })
})

// Live, Slack shares a fresh image before it has made thumbnails: the echo has no `thumb_*` and no size, and
// `file_thumbnail_generated` follows (research section 3, "Files"). The sent image shows its staged copy at its
// final size from the first frame, then Slack's thumbnail in the same box.
test('a sent image Slack has no thumbnails for yet shows at once from the local copy, then takes Slack\'s in the same box', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  fake.holdThumbnails()
  await paste(topic.composer, [chart()])
  await staged(topic, 1)
  fake.holdNext({ method: 'files.share', before: true })
  await topic.send('Before the thumbnails')
  const row = topic.message('Before the thumbnails')
  const image = row.locator('[data-thumbnail][title="chart.png"]')
  await expect(image).toBeVisible()
  expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })

  await expectStableAnchor(win, '[data-message-row] [data-thumbnail][title="chart.png"]', async () => {
    fake.release()
    await topic.expectSent('Before the thumbnails')
    // Stored without thumbnails: still the staged copy, still an image.
    await expect(image.locator(`img${schemeSrc('uploads')}`)).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Download chart.png' })).toHaveCount(0)
    // After the first background try Slack makes them, and file_created follows.
    await expect.poll(() => fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'file').length, { timeout: 15_000 }).toBeGreaterThan(0)
    fake.releaseThumbnails({ event: 'file_created' })
    await expect(image.locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(() => image.locator(`img${schemeSrc('files')}`).evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  }, { within: '[data-topic-view]' })
  expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })
  expect(fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'file').length).toBeGreaterThan(0)
})

// The download goes through the browser's own download, which happy-dom does not have.
test('a stored message\'s file downloads into Downloads', async ({ juno, userData }) => {
  const { topic } = juno
  await juno.sidebar.row(PROPOSAL).open()
  const download = topic.list.getByRole('button', { name: /^Download (q4-plan\.pdf|Q4 plan)$/ })
  await download.scrollIntoViewIfNeeded()
  const browserDownload = juno.surface.kind === 'web' ? juno.win.waitForEvent('download') : undefined
  await download.click()
  let saved: string
  if (browserDownload !== undefined) {
    const file = await browserDownload
    saved = join(userData, 'Downloads', file.suggestedFilename())
    await file.saveAs(saved)
  } else {
    await expect.poll(() => juno.app.evaluate(() => (globalThis as unknown as { junoTest: { downloads: string[] } }).junoTest.downloads.length)).toBe(1)
    saved = await juno.app.evaluate(() => (globalThis as unknown as { junoTest: { downloads: string[] } }).junoTest.downloads[0]!)
  }
  expect(saved).toMatch(/Downloads\/q4-plan\.pdf$/)
  expect((await readFile(saved)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
})
