// Attachments (spec section 8; architecture 9): paste, drop and the attach
// button stage files as chips; a send uploads them with the text through
// the outbox; a failed upload keeps the text and the files for Retry; a
// message's images open in the viewer, and a file card opens a Markdown file
// whole. Sizes, the local copy before Slack's thumbnails and Download stay in
// the browser lane (`e2e/attachments.spec.ts`); a PDF, an HTML page and Quick
// Look are main's (`e2e/file-viewer.spec.ts`).
import { brief, chart, chip, chips, drop, paste, pick, staged } from './attach'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const ENG_MAIN = '#eng'


domTest('drops, pastes and picks files in Main, replies and Home, retries a failed upload, and opens images in the viewer', async ({ juno, fake, step }) => {
  const context = { juno, fake }
  await step('a file dropped on the topic is sent on its own as a file row with Download', () => dropInMain(context))
  await step('a file dropped on a reply composer is attached once and shared in that thread', () => dropInReply(context))
  await step('a removed chip is not sent, and a file picked with Attach files is', () => removeBeforeSending(context))
  await step('a failed upload keeps the text and the file for Retry, and is sent once', () => failedUpload(context))
  await step('Home keeps its files through a change of destination and sends them to the last one', () => homeKeepsFiles(context))
  await step('several images open in the viewer at the one clicked, and the keys and the filmstrip move through them', () => viewer(context))
  await step('a Markdown file card opens the whole file in the viewer, and a voice clip plays Slack\'s transcoded copy', () => fileCards(context))
}, { timeout: 120_000 })

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


async function fileCards(context: Context): Promise<void> {
  const { juno, fake } = context
  await openEngMain(context)
  fake.control('injectFiles', { channel: 'C0ENG', text: 'Notes and metrics', files: [{ kind: 'markdown' }] })
  const row = juno.topic.message('Notes and metrics')
  await expect(row.locator('[data-file-card]')).toHaveCount(1)

  // The snippet's preview is cut short; the viewer reads the whole file.
  await row.getByRole('button', { name: 'Open release-notes.md' }).click()
  const viewer = juno.win.getByRole('dialog')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('release-notes.md')
  await expect(viewer.locator('[data-viewer-text]').getByText('Questions go to the release thread.')).toBeVisible()
  await juno.win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)

  // A voice clip plays Slack's transcoded copy.
  fake.control('injectFiles', { channel: 'C0ENG', text: 'Voice note', files: [{ kind: 'voice' }] })
  await expect(juno.topic.message('Voice note').locator('audio[data-inline-audio]')).toHaveAttribute('src', /aac%3D1$/)
}
