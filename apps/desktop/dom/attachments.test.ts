// Attachments (spec section 8; architecture 9): paste, drop and the attach
// button stage files as chips; a send uploads them with the text through
// the outbox; a failed upload keeps the text and the files for Retry; a
// message's images open in the viewer. Sizes, the local copy before Slack's
// thumbnails and Download stay in the browser lane (`e2e/attachments.spec.ts`).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brief, chart, chip, chips, drop, paste, pick, staged } from './attach'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const ENG_MAIN = '#eng'

domTest('an attachment that cannot be read has a title for its reason and a safe app log entry', async ({ juno, app, userData }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  const File = (app.window as unknown as { File: typeof globalThis.File }).File
  for (const failure of ['read_error', 'bad_chunk'] as const) {
    // A File can become unreadable after selection. A short first read also exercises the real engine's offset refusal.
    const slice = File.prototype.slice
    File.prototype.slice = function (this: File, start, end, type) {
      if (this.name !== `unreadable-${failure}.dmg`) return slice.call(this, start, end, type)
      File.prototype.slice = slice
      if (failure === 'read_error') throw new DOMException('File became unavailable', 'NotReadableError')
      return slice.call(this, start, (end ?? this.size) - 1, type)
    }
    await paste(topic.composer, [{ name: `unreadable-${failure}.dmg`, mimeType: '', buffer: Buffer.alloc(3 * 1024 * 1024) }])
    const failed = topic.root.locator('[data-attachment="failed"]')
    await expect(failed).toHaveCount(1)

    await expect(failed).toHaveAttribute('title', failure === 'read_error' ? 'Could not read this file' : 'Could not attach this file. Try attaching it again.')
    await expect.poll(async () => readFile(join(userData, 'logs', 'main.log'), 'utf8')).toMatch(new RegExp(`files: staging failed.*reason=${failure}.*offset=${failure === 'read_error' ? 0 : 1024 * 1024}`))
    const log = await readFile(join(userData, 'logs', 'main.log'), 'utf8')
    expect(log).not.toContain('unreadable-')
    expect(log).not.toContain('File became unavailable')
    await chip(topic, `unreadable-${failure}.dmg`).click()
    await paste(topic.composer, [{ name: 'retry.dmg', mimeType: '', buffer: Buffer.alloc(3 * 1024 * 1024) }])
    await staged(topic, 1)
    await chip(topic, 'retry.dmg').click()
    await expect(chips(topic)).toHaveCount(0)
  }
})

domTest('drops, pastes and picks files in Main, replies and Home, retries a failed upload, and opens images in the viewer', async ({ juno, fake, step }) => {
  const context = { juno, fake }
  await step('a file dropped on the topic is sent on its own as a file row with Download', () => dropInMain(context))
  await step('a file dropped on a reply composer is attached once and shared in that thread', () => dropInReply(context))
  await step('a removed chip is not sent, and a file picked with Attach files is', () => removeBeforeSending(context))
  await step('a failed upload keeps the text and the file for Retry, and is sent once', () => failedUpload(context))
  await step('Home keeps its files through a change of destination and sends them to the last one', () => homeKeepsFiles(context))
  await step('several images open in the viewer at the one clicked, and the keys and the filmstrip move through them', () => viewer(context))
})

type Context = Pick<DomContext, 'juno' | 'fake'>

async function openEngMain({ juno }: Context): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
}

async function dropInMain(context: Context): Promise<void> {
  const { juno, fake } = context
  fake.resetCalls()
  const { topic } = juno
  await openEngMain(context)

  await drop(topic.list, [brief()])
  await expect(chip(topic, 'launch-brief.pdf')).toBeVisible()
  await expect(topic.root.locator('[data-composer]')).toContainText('launch-brief.pdf')
  await staged(topic, 1)
  await topic.composer.press('Enter')
  await expect(chips(topic)).toHaveCount(0)

  const row = topic.list.locator('[data-message-row]').filter({ hasText: 'launch-brief.pdf' })
  await expect(row).toHaveCount(1)
  await expect.poll(() => row.getAttribute('data-pending'), { timeout: 15_000 }).toBe(null)
  await expect(row.getByRole('button', { name: 'Download launch-brief.pdf' })).toBeVisible()
  const share = fake.calls.find((call) => call.method === 'files.share')
  expect(share?.args['comment']).toBeUndefined()
  expect(share?.args['blocks']).toBeUndefined()
}

async function dropInReply({ juno, fake }: Context): Promise<void> {
  fake.resetCalls()
  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith('Draft plan is in the doc'))!
  await juno.sidebar.row('Draft plan is in the doc').open()
  await topic.expectTitle('Draft plan is in the doc')
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

async function removeBeforeSending(context: Context): Promise<void> {
  const { juno, fake } = context
  fake.resetCalls()
  const { topic } = juno
  await openEngMain(context)
  await topic.composer.fill('Two files, then one')

  await paste(topic.composer, [chart(), brief()])
  await expect(chips(topic)).toHaveCount(2)
  await chip(topic, 'chart.png').click()
  await expect(chips(topic)).toHaveCount(1)
  await expect(topic.composer).toHaveValue('Two files, then one')

  // Staging in chunks and a file with no MIME type are the engine's outbox-copies flow test; this is the picker.
  await pick(topic.root.locator('[data-composer] input[type="file"]'), [{ name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.alloc(64 * 1024, 9) }])
  await staged(topic, 2)

  await topic.composer.press('Enter')
  await topic.expectSent('Two files, then one')
  expect(fake.calls.filter((call) => call.method === 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['launch-brief.pdf', 'archive.zip'])
}

async function failedUpload(context: Context): Promise<void> {
  const { juno, fake } = context
  fake.resetCalls()
  const { topic } = juno
  await openEngMain(context)

  await pick(topic.root.locator('[data-composer] input[type="file"]'), [chart()])
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
}

async function homeKeepsFiles({ juno, fake }: Context): Promise<void> {
  fake.resetCalls()
  const { tabs, write } = juno
  await tabs.newTabButton.click()
  await write.write('Brief for the launch')
  await paste(write.composer, [brief()])
  const briefChip = chip(write, 'launch-brief.pdf')
  await expect(briefChip).toBeVisible()
  await write.pickConversation('eng', 'eng')
  await expect(briefChip).toBeVisible()
  await write.pickConversation('product', 'product')
  await expect(briefChip).toBeVisible()
  await expect(write.composer).toHaveValue('Brief for the launch')
  await staged(write, 1)

  await write.send()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'files.share').map((call) => call.args['channel'])).toEqual(['C0PRODUCT'])
  await expect(briefChip).toHaveCount(0)
}

// A message's images make a grid in the message; any of them opens the media viewer at it, with every one in a
// filmstrip along the bottom. ← and → move and stop at the ends, the strip shows the one clicked, and Esc closes
// with focus back on the tile that opened it.
async function viewer(context: Context): Promise<void> {
  const { juno, fake } = context
  const { topic, win } = juno
  await openEngMain(context)

  const names = ['rack-front.png', 'rack-back.png', 'cable-map.png', 'patch-panel.png']
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Photos from the rack move', media: names.map((name, index) => ({ name, width: 800 + index * 100, height: 600 })) })
  const row = topic.message('Photos from the rack move')
  const grid = row.locator('[data-thumbnail-grid]')
  await expect(grid).toHaveAttribute('data-count', '4')
  await expect(grid.locator('[data-thumbnail]')).toHaveCount(4)

  const third = row.getByRole('button', { name: 'Open cable-map.png' })
  await third.click()
  const dialog = win.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const current = dialog.locator('[data-viewer-item]')
  const strip = dialog.getByRole('group', { name: 'All pictures in this message' })
  await expect(current).toHaveAttribute('data-viewer-item', '3')
  await expect(dialog.locator('[data-viewer-name]')).toHaveText('cable-map.png')
  // The header names the message's sender.
  await expect(dialog.locator('[data-viewer-meta]')).toHaveText(/^Maya\b.* · .+ · 3 of 4$/)
  await expect(strip.getByRole('button')).toHaveCount(4)
  await expect(strip.getByRole('button', { name: 'Show cable-map.png' })).toHaveAttribute('aria-current', 'true')

  await win.keyboard.press('ArrowRight')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await expect(dialog.getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true')
  await win.keyboard.press('ArrowRight')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await win.keyboard.press('ArrowLeft')
  await expect(current).toHaveAttribute('data-viewer-item', '3')

  await strip.getByRole('button', { name: 'Show rack-front.png' }).click()
  await expect(current).toHaveAttribute('data-viewer-item', '1')
  await expect(strip.getByRole('button', { name: 'Show rack-front.png' })).toHaveAttribute('aria-current', 'true')
  await expect(dialog.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true')
  await win.keyboard.press('End')
  await expect(current).toHaveAttribute('data-viewer-item', '4')
  await win.keyboard.press('Home')
  await expect(current).toHaveAttribute('data-viewer-item', '1')

  await win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(third).toBeFocused()
}

