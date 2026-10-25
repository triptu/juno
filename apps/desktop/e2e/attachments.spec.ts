// Attachments (spec section 8; architecture 9): paste, drop and the attach
// button stage files as chips; a send uploads them with the text through
// the outbox; a failed upload keeps the text and the files for Retry; a
// message's image opens in the viewer and a file downloads into Downloads.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schemeSrc } from './driver/juno'
import { expect, test, type Fixtures } from './fixtures'
import { brief, chart, chip, chips, drop, paste, staged } from './attach'
import { expectStableAnchor } from './shiftProbe'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const PROPOSAL = 'Proposal: cut offline mode'

for (const failure of ['read_error', 'bad_chunk'] as const) {
  test(`an attachment ${failure} has a specific title and a safe app log entry`, async ({ juno, win, userData }) => {
    const { topic } = juno
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    // A File can become unreadable after selection. A short first read also exercises the real engine's offset refusal.
    await win.evaluate((reason) => {
      const slice = File.prototype.slice
      File.prototype.slice = function (start, end, type) {
        if (this.name !== 'unreadable.dmg') return slice.call(this, start, end, type)
        File.prototype.slice = slice
        if (reason === 'read_error') throw new DOMException('File became unavailable', 'NotReadableError')
        return slice.call(this, start, (end ?? this.size) - 1, type)
      }
    }, failure)
    await paste(topic.composer, [{ name: 'unreadable.dmg', mimeType: '', buffer: Buffer.alloc(3 * 1024 * 1024) }])
    const failed = topic.root.locator('[data-attachment="failed"]')
    await expect(failed).toHaveCount(1)

    await expect(failed).toHaveAttribute('title', failure === 'read_error' ? 'Could not read this file' : 'Could not attach this file. Try attaching it again.')
    await expect.poll(async () => readFile(join(userData, 'logs', 'main.log'), 'utf8')).toMatch(new RegExp(`files: staging failed.*reason=${failure}.*offset=${failure === 'read_error' ? 0 : 1024 * 1024}`))
    const log = await readFile(join(userData, 'logs', 'main.log'), 'utf8')
    expect(log).toContain('files: staging failed')
    expect(log).not.toContain('unreadable.dmg')
    expect(log).not.toContain('File became unavailable')
    await chip(topic, 'unreadable.dmg').click()
    await paste(topic.composer, [{ name: 'retry.dmg', mimeType: '', buffer: Buffer.alloc(3 * 1024 * 1024) }])
    await staged(topic, 1)
  })
}

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

// Images that arrive or are stored before Slack made thumbnails, and the four background tries, are the engine's
// file-thumbnails flow test.
test('drops files in Main and replies and removes a chip before sending', async ({ juno, fake, win, userData }) => {
  const context = { juno, fake, win, userData }
  await test.step('a file dropped on the topic is sent on its own as a file row with Download', () => dropInMain(context))
  await test.step('a file dropped on a reply composer is attached once and shared in that thread', () => dropInReply(context))
  await test.step('a removed chip is not sent, a file picked with Attach files is, and the text row does not move', () => removeBeforeSending(context))
})

async function dropInMain({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await drop(topic.list, [brief()])
  await expect(chip(topic, 'launch-brief.pdf')).toBeVisible()
  await expect(topic.root.locator('[data-composer]')).toContainText('launch-brief.pdf')
  await staged(topic, 1)
  await topic.composer.press('Enter')
  await expect(chips(topic)).toHaveCount(0)

  const row = topic.list.locator('[data-message-row]').filter({ hasText: 'launch-brief.pdf' })
  await expect(row).toHaveCount(1)
  await expect(row).not.toHaveAttribute('data-pending', /.*/, { timeout: 15_000 })
  await expect(row.getByRole('button', { name: 'Download launch-brief.pdf' })).toBeVisible()
  const share = fake.calls.find((call) => call.method === 'files.share')
  expect(share?.args['comment']).toBeUndefined()
  expect(share?.args['blocks']).toBeUndefined()
}

async function dropInReply({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith('Draft plan is in the doc'))!
  await juno.sidebar.row('Draft plan is in the doc').open()
  await drop(topic.composer, [brief()])
  await expect(chips(topic)).toHaveCount(1)
  await staged(topic, 1)
  await topic.send('The launch brief')
  await topic.expectSent('The launch brief')
  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  expect(shares[0]!.args['thread_ts']).toBe(root.ts)
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL')).toHaveLength(1)
}

async function removeBeforeSending({ juno, fake, win, userData }: Pick<Fixtures, 'juno' | 'fake' | 'win' | 'userData'>): Promise<void> {
  fake.resetCalls()

  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.fill('Two files, then one')
  const field = await topic.composer.boundingBox()

  await paste(topic.composer, [chart(), brief()])
  await expect(chips(topic)).toHaveCount(2)
  expect((await topic.composer.boundingBox())!.y).toBe(field!.y)
  await chip(topic, 'chart.png').click()
  await expect(chips(topic)).toHaveCount(1)
  expect((await topic.composer.boundingBox())!.y).toBe(field!.y)
  await expect(topic.composer).toHaveValue('Two files, then one')

  // Staging in chunks and a file with no MIME type are the engine's outbox-copies flow test; this is the picker.
  const downloads = join(userData, 'Downloads')
  await mkdir(downloads, { recursive: true })
  const archive = join(downloads, 'archive.zip')
  await writeFile(archive, Buffer.alloc(64 * 1024, 9))
  const chooser = win.waitForEvent('filechooser')
  await topic.root.getByRole('button', { name: 'Attach files', exact: true }).click()
  await (await chooser).setFiles(archive)
  await staged(topic, 2)
  expect((await topic.composer.boundingBox())!.y).toBe(field!.y)

  await topic.composer.press('Enter')
  await topic.expectSent('Two files, then one')
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['launch-brief.pdf', 'archive.zip'])
}

test('a failed upload keeps the text and the file for Retry, and is sent once', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await topic.root.locator('[data-composer] input[type="file"]').setInputFiles([chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await staged(topic, 1)
  fake.failUploads({ times: 1 })
  await topic.send('Retry this one')
  const failed = topic.failed('Retry this one')
  await expect(failed.row).toContainText('Not sent.', { timeout: 15_000 })
  await expect(failed.row.getByRole('img', { name: 'chart.png' }).or(failed.row.getByRole('button', { name: 'Open chart.png' }))).toBeVisible()
  expect(fake.calls.filter((call) => call.method === 'files.share')).toEqual([])

  await failed.retry()
  await topic.expectSent('Retry this one')
  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  expect(fake.messages('C0ENG').filter((m) => m.client_msg_id === shares[0]!.args['client_msg_id'])).toHaveLength(1)
})

test('Home keeps its files through a change of destination and sends them to the last one', async ({ juno, fake }) => {
  const { tabs, write } = juno
  await tabs.newTabButton.click()
  await write.write('Brief for the launch')
  await paste(write.composer, [brief()])
  const briefChip = write.root.locator('[data-composer]').getByRole('button', { name: 'Remove launch-brief.pdf' })
  await expect(briefChip).toBeVisible()
  await write.pickConversation('eng', 'eng')
  await expect(briefChip).toBeVisible()
  await write.pickConversation('product', 'product')
  await expect(briefChip).toBeVisible()
  await expect(write.composer).toHaveValue('Brief for the launch')
  await staged(write, 1)

  await write.send()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'files.share').map((call) => call.args['channel'])).toEqual(['C0PRODUCT'])
  await tabs.expectActiveAt('Home', 1)
  await expect(briefChip).toHaveCount(0)
})

test("a stored message's image opens in the viewer and its file downloads into Downloads", async ({ juno, userData }) => {
  const { topic } = juno
  await juno.sidebar.row(PROPOSAL).open()
  await test.step('an image opens in the viewer, and Esc closes it', async () => {
    const open = topic.list.getByRole('button', { name: /^Open early-access-flow\.png$|^Open Early access flow$/ })
    await open.scrollIntoViewIfNeeded()
    await open.click()
    const viewer = juno.win.getByRole('dialog')
    await expect(viewer).toBeVisible()
    await expect.poll(() => viewer.locator('img[src*="/full?"]').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused()
    await juno.win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(open).toBeFocused()
  })
  await test.step('Download saves the file into Downloads', async () => {
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
})

// A message's images make a grid in the message; any of them opens the media viewer at it, with every one in a
// filmstrip along the bottom. ← and → move and stop at the ends, the strip shows the one clicked, and Esc closes
// with focus back on the tile that opened it.
test('several images open in the viewer at the one clicked, and the keys and the filmstrip move through them', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  const names = ['rack-front.png', 'rack-back.png', 'cable-map.png', 'patch-panel.png']
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Photos from the rack move', media: names.map((name, index) => ({ name, width: 800 + index * 100, height: 600 })) })
  const row = topic.message('Photos from the rack move')
  const grid = row.locator('[data-thumbnail-grid]')
  await expect(grid).toHaveAttribute('data-count', '4')
  await expect(grid.locator('[data-thumbnail]')).toHaveCount(4)
  expect(await grid.boundingBox()).toMatchObject({ width: 360, height: 240 })

  const third = row.getByRole('button', { name: 'Open cable-map.png' })
  await third.click()
  const viewer = win.getByRole('dialog')
  await expect(viewer).toBeVisible()
  const current = viewer.locator('[data-viewer-item]')
  const strip = viewer.getByRole('group', { name: 'All pictures in this message' })
  await expect(current).toHaveAttribute('data-viewer-item', '3')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('cable-map.png')
  // The header names the message's sender, as the message's own header does.
  const sender = await row.locator('[data-person-name]').first().getAttribute('data-person-name')
  expect(sender).toBeTruthy()
  await expect(viewer.locator('[data-viewer-meta]')).toHaveText(new RegExp(`^${sender} · .+ · 3 of 4$`))
  await expect(strip.getByRole('button')).toHaveCount(4)
  await expect(strip.getByRole('button', { name: 'Show cable-map.png' })).toHaveAttribute('aria-current', 'true')

  await win.keyboard.press('ArrowRight')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await expect(viewer.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true')
  await win.keyboard.press('ArrowRight')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await win.keyboard.press('ArrowLeft')
  await expect(current).toHaveAttribute('data-viewer-item', '3')

  await strip.getByRole('button', { name: 'Show rack-front.png' }).click()
  await expect(current).toHaveAttribute('data-viewer-item', '1')
  await expect(strip.getByRole('button', { name: 'Show rack-front.png' })).toHaveAttribute('aria-current', 'true')
  await expect(viewer.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true')
  await win.keyboard.press('End')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await win.keyboard.press('Home')
  await expect(current).toHaveAttribute('data-viewer-item', '1')
  await expect.poll(() => current.locator('img[alt="rack-front.png"]').evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)

  await win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(third).toBeFocused()
})
