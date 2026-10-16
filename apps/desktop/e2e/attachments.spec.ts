// Attachments (spec section 8; architecture 9): paste, drop and the attach
// button stage files as chips; a send uploads them with the text through
// the outbox; a failed upload keeps the text and the files for Retry; a
// message's image opens in the viewer and a file downloads into Downloads.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Locator, Page } from '@playwright/test'
import { samplePdf, samplePng } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { TopicPane } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const PROPOSAL = 'Proposal: cut offline mode'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'

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

test('a file dropped on the topic is sent on its own as a file row with Download', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await drop(topic.list, [brief()])
  await expect(chip(topic, 'launch-brief.pdf')).toBeVisible()
  await expect(topic.root.locator('[data-composer]')).toContainText('launch-brief.pdf')
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


test('a send check keeps the draft while a newly attached file is still being read', async ({ juno, fake, userData }) => {
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
  await post.click()
  await expect(topic.composer).toHaveValue(BILL_REPLY)
  await expect(post).toBeVisible()
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage' || call.method === 'files.share')).toHaveLength(0)

  await juno.win.evaluate(() => window.dispatchEvent(new Event('release-file-read')))
  await expect(topic.root.locator('[data-composer] img[src^="juno://uploads/"]')).toHaveCount(1)
  await post.click()
  await expect(topic.composer).toHaveValue('')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'files.share').length).toBe(1)
})
