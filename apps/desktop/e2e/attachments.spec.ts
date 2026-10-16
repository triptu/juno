// Attachments (spec section 8; architecture 9): paste, drop and the attach
// button stage files as chips; a send uploads them with the text through
// the outbox; a failed upload keeps the text and the files for Retry; a
// message's image opens in the viewer and a file downloads into Downloads.
import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { samplePdf, samplePng } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { TopicPane } from './driver/juno'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const PROPOSAL = 'Proposal: cut offline mode'

interface Upload {
  readonly name: string
  readonly mimeType: string
  readonly buffer: Buffer
}

const chart = (): Upload => ({ name: 'chart.png', mimeType: 'image/png', buffer: samplePng(640, 400) })
const brief = (): Upload => ({ name: 'launch-brief.pdf', mimeType: 'application/pdf', buffer: samplePdf('Launch brief', ['Freeze on Thursday.']) })

/** Builds a DataTransfer holding `files` in the page. */
function dataTransfer(win: Page, files: ReadonlyArray<Upload>) {
  return win.evaluateHandle((list) => {
    const transfer = new DataTransfer()
    for (const file of list) transfer.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: file.mimeType }))
    return transfer
  }, files.map((file) => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString('base64') })))
}

/** Pastes `files` into a composer's field, as ⌘V with files on the clipboard. */
async function paste(field: Locator, files: ReadonlyArray<Upload>): Promise<void> {
  const transfer = await dataTransfer(field.page(), files)
  await field.focus()
  await field.evaluate((element, data) => element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })), transfer)
}

/** Drags `files` over `target` and drops them there. */
async function drop(target: Locator, files: ReadonlyArray<Upload>): Promise<void> {
  const transfer = await dataTransfer(target.page(), files)
  await target.dispatchEvent('dragenter', { dataTransfer: transfer })
  await target.dispatchEvent('dragover', { dataTransfer: transfer })
  await target.dispatchEvent('drop', { dataTransfer: transfer })
}

const chips = (topic: TopicPane) => topic.root.locator('[data-composer]').getByRole('button', { name: /^Remove / })
const chip = (topic: TopicPane, name: string) => topic.root.locator('[data-composer]').getByRole('button', { name: `Remove ${name}` })
/** Waits until `count` of a pane's chips are staged. Enter does nothing while a file is still being read, so a send waits for this. */
const staged = (pane: { readonly root: Locator }, count: number) => expect(pane.root.locator('[data-composer] [data-attachment="ready"]')).toHaveCount(count)

test('a pasted image goes with the message and shows in it at its final size', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await expect(topic.root.locator('[data-composer] img[src^="juno://uploads/"]')).toHaveCount(1)

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
  await expect(row.getByRole('button', { name: 'Open chart.png' }).locator('img[src^="juno://files/"]')).toHaveCount(1, { timeout: 15_000 })
  const settled = await row.getByRole('button', { name: 'Open chart.png' }).boundingBox()
  expect({ width: settled!.width, height: settled!.height }).toEqual({ width: 360, height: 225 })

  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  const posted = fake.messages('C0ENG').filter((m) => m.client_msg_id === shares[0]!.args['client_msg_id'])
  expect(posted.map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png']])
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toEqual([])
})

// Live, Slack shares a fresh image before it has made thumbnails: the echo has no `thumb_*` and no size, and
// `file_thumbnail_generated` follows (research section 3, "Files"). The sent image shows its staged copy at its
// final size from the first frame, then Slack's thumbnail in the same box.
test('a sent image Slack has no thumbnails for yet shows at once from the local copy, then takes Slack\'s in the same box', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
    await expect(image.locator('img[src^="juno://uploads/"]')).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Download chart.png' })).toHaveCount(0)
    fake.releaseThumbnails()
    await expect(image.locator('img[src^="juno://files/"]')).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(() => image.locator('img[src^="juno://files/"]').evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  })
  expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })
  expect(fake.calls.filter((call) => call.method === 'files.info').length).toBeGreaterThan(0)
})

test('another person\'s image that arrives without thumbnails fills in after the refetch', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  fake.holdThumbnails()
  fake.injectImages({ channel: 'C0ENG', user: 'U0MAYA', text: 'Whiteboard from today', images: [{ name: 'whiteboard.png', width: 800, height: 600 }] })
  const row = topic.message('Whiteboard from today')
  await expect(row.getByRole('button', { name: 'Download whiteboard.png' })).toBeVisible()
  // The first try finds no thumbnails yet; Slack makes them without an event, and a later try brings them.
  await expect.poll(() => fake.calls.filter((call) => call.method === 'files.info').length, { timeout: 15_000 }).toBeGreaterThan(0)
  fake.releaseThumbnails({ event: 'none' })
  const image = row.getByRole('button', { name: 'Open whiteboard.png' })
  await expect(image.locator('img[src^="juno://files/"]')).toHaveCount(1, { timeout: 20_000 })
  expect(await image.boundingBox()).toMatchObject({ width: 320, height: 240 })
})

test('a file dropped on the topic is sent on its own as a file row with Download', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('a file dropped on a reply composer is attached once and shared in that thread', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('a removed chip is not sent, and the text row does not move', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
  await staged(topic, 1)

  await topic.composer.press('Enter')
  await topic.expectSent('Two files, then one')
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['launch-brief.pdf'])
})

test('a failed upload keeps the text and the file for Retry, and is sent once', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

test('a New chat keeps its files through a change of destination and sends them to the last one', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno
  await tabs.newTabButton.click()
  await newChat.write('Brief for the launch')
  await paste(newChat.composer, [brief()])
  const briefChip = newChat.root.locator('[data-composer]').getByRole('button', { name: 'Remove launch-brief.pdf' })
  await expect(briefChip).toBeVisible()
  await newChat.pickConversation('eng', 'eng')
  await expect(briefChip).toBeVisible()
  await newChat.pickConversation('product', 'product')
  await expect(briefChip).toBeVisible()
  await expect(newChat.composer).toHaveValue('Brief for the launch')
  await staged(newChat, 1)

  await newChat.send()
  await topic.expectSent('Brief for the launch')
  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares.map((call) => call.args['channel'])).toEqual(['C0PRODUCT'])
})

test('an image opens in the viewer, and Esc closes it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(PROPOSAL).open()
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

test('Download saves the file into Downloads', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(PROPOSAL).open()
  const download = topic.list.getByRole('button', { name: /^Download (q4-plan\.pdf|Q4 plan)$/ })
  await download.scrollIntoViewIfNeeded()
  await download.click()
  const saved = await expect
    .poll(() => juno.app.evaluate(() => (globalThis as unknown as { junoTest: { downloads: string[] } }).junoTest.downloads.slice()), { timeout: 15_000 })
    .toHaveLength(1)
    .then(() => juno.app.evaluate(() => (globalThis as unknown as { junoTest: { downloads: string[] } }).junoTest.downloads[0]!))
  expect(saved).toMatch(/Downloads\/q4-plan\.pdf$/)
  expect((await readFile(saved)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
})


test('a send check keeps the draft while a newly attached file is still being read', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.fill('can you recieve the the report by friday')
  await topic.composer.press('Enter')
  const fix = topic.root.getByRole('button', { name: /Fix and send/ })
  await expect(fix).toBeVisible()

  // Hold the file read, as when the selected file is on a slow volume.
  await juno.win.evaluate(() => {
    const slice = File.prototype.slice
    File.prototype.slice = function (...args) {
      File.prototype.slice = slice
      const blob = slice.apply(this, args)
      const read = blob.arrayBuffer.bind(blob)
      blob.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => {
        window.addEventListener('release-file-read', () => void read().then(resolve), { once: true })
      })
      return blob
    }
  })
  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await fix.click()
  await expect(topic.composer).toHaveValue('can you recieve the the report by friday')
  await expect(fix).toBeVisible()
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage' || call.method === 'files.share')).toHaveLength(0)

  await juno.win.evaluate(() => window.dispatchEvent(new Event('release-file-read')))
  await expect(topic.root.locator('[data-composer] img[src^="juno://uploads/"]')).toHaveCount(1)
  await fix.click()
  await topic.expectSent('can you receive the report by friday?')
  expect(fake.calls.filter((call) => call.method === 'files.share')).toHaveLength(1)
})

// A message's images make a grid in the message; any of them opens the media viewer at it, with every one in a
// filmstrip along the bottom. ← and → move and stop at the ends, the strip shows the one clicked, and Esc closes
// with focus back on the tile that opened it.
test('several images open in the viewer at the one clicked, and the keys and the filmstrip move through them', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  const names = ['rack-front.png', 'rack-back.png', 'cable-map.png', 'patch-panel.png']
  fake.injectImages({ channel: 'C0ENG', user: 'U0MAYA', text: 'Photos from the rack move', images: names.map((name, index) => ({ name, width: 800 + index * 100, height: 600 })) })
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
