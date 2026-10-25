// Images stored before Slack made their thumbnails (`@juno/sync` `run/files.ts`; research section 3,
// "Files"): the engine asks again on the background lane, at most four times, re-reading only that
// message when files.info cannot answer, and a file event asks at once. The image then takes Slack's
// thumbnail in place of the card, or of the staged copy a sent image shows until then. The browser test
// in attachments.spec.ts checks the sent image keeps its box through the swap.
import { expect, it } from 'bun:test'
import type { FileView } from '@juno/contract'
import { samplePng } from '@juno/fake-slack'
import { attachFiles, attachmentsAtom, clearAttachments, readyFiles, sendMessage } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { MAIN, outboxScenario, textOf, type Rows } from '../outboxScenario'
import { apiCalls, threadId, valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened } = outboxScenario()

const chart = () => new File([samplePng(800, 600)], 'chart.png', { type: 'image/png' })
const fileTries = (engine: RunningEngine, method: 'conversations.history' | 'conversations.replies') =>
  apiCalls(engine, method).filter((call) => call.args['_x_reason'] === 'file')
const imageIn = (rows: Rows, text: string): FileView | undefined => rows.find((row) => textOf(row) === text && row.pending === undefined)?.files[0]
const slackThumb = (file: FileView | undefined) => file?.thumb?.src.startsWith('juno://files/') === true

/** Sends `text` with a chart from the composer of `topic`. */
async function sendChart(engine: RunningEngine, topic: string, target: Parameters<typeof sendMessage>[1], text: string): Promise<void> {
  const unmount = engine.registry.mount(attachmentsAtom(topic))
  try {
    clearAttachments(engine.registry, topic)
    await attachFiles(engine.registry, topic, [chart()])
    valueOf(await sendMessage(engine.registry, target, text, topic, readyFiles(engine.registry, topic)!))
  } finally {
    unmount()
  }
}

it("fills in another person's image once Slack has made its thumbnails, without a file event", async () => {
  const engine = await booted()
  const rows = await opened(engine)
  engine.fake.holdThumbnails()
  engine.fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Whiteboard from today', media: [{ name: 'whiteboard.png', width: 800, height: 600 }] })

  await step('stored without thumbnails, the image is a card the user can download', async () => {
    const card = imageIn(await rows((list) => imageIn(list, 'Whiteboard from today') !== undefined, 'the message'), 'Whiteboard from today')!
    expect(card).toMatchObject({ name: 'whiteboard.png', kind: 'image' })
    expect(card.thumb).toBeUndefined()
    expect(card.download).toBeDefined()
  })

  await step('the first try finds none; Slack makes them with no event, and a later try brings them', async () => {
    await waitFor(() => (fileTries(engine, 'conversations.history').length > 0 ? true : undefined), WAIT_MS, 'the first try')
    engine.fake.releaseThumbnails({ event: 'none' })
    const image = imageIn(await rows((list) => slackThumb(imageIn(list, 'Whiteboard from today')), 'the thumbnail'), 'Whiteboard from today')!
    expect(image.thumb!.width / image.thumb!.height).toBe(800 / 600)
  })
})

it('a reply image takes its thumbnails by re-reading only that reply when files.info is not available', async () => {
  const engine = await booted()
  const thread = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
  const rows = watch(engine, thread)
  engine.fake.setFilesInfoSupported({ supported: false })
  engine.fake.holdThumbnails()
  await sendChart(engine, thread, { kind: 'channel', channelId: 'C0ENG', threadTs: thread.split(':')[2]! }, 'The processed reply image')

  await step('sent, it shows the staged copy', async () => {
    const sent = imageIn(await rows((list) => imageIn(list, 'The processed reply image') !== undefined, 'the reply stored'), 'The processed reply image')!
    expect(sent.thumb?.src).toStartWith('juno://uploads/')
  })

  await step("a later try reads the reply, not the thread, and takes Slack's thumbnail", async () => {
    await waitFor(() => (fileTries(engine, 'conversations.replies').length > 0 ? true : undefined), WAIT_MS, 'a reply read')
    engine.fake.releaseThumbnails({ event: 'none' })
    await rows((list) => slackThumb(imageIn(list, 'The processed reply image')), 'the thumbnail')
    const reads = fileTries(engine, 'conversations.replies')
    expect(reads.every((call) => call.args['ts'] === thread.split(':')[2] && call.args['oldest'] === call.args['latest'])).toBe(true)
    const info = apiCalls(engine, 'files.info')
    expect(info.length).toBeGreaterThan(0)
    expect(info.every((call) => call.error === 'unknown_method')).toBe(true)
  })
})

it('a sent image keeps its staged copy after all four tries, and file_created brings the thumbnail later', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  engine.fake.holdThumbnails()
  await sendChart(engine, MAIN, { kind: 'channel', channelId: 'C0ENG' }, 'Before the thumbnails')

  await step('stops asking after four tries, and the message still shows the staged image', async () => {
    await rows((list) => imageIn(list, 'Before the thumbnails') !== undefined, 'the message stored')
    await waitFor(() => (fileTries(engine, 'conversations.history').length === 4 ? true : undefined), WAIT_MS, 'four tries')
    const image = imageIn(await rows(() => true, 'the window'), 'Before the thumbnails')!
    expect(image.thumb?.src).toStartWith('juno://uploads/')
  })

  await step('file_created names the file, and the next read brings Slack’s thumbnail', async () => {
    engine.fake.releaseThumbnails({ event: 'file_created' })
    const image = imageIn(await rows((list) => slackThumb(imageIn(list, 'Before the thumbnails')), 'the thumbnail'), 'Before the thumbnails')!
    expect(image.thumb!.width / image.thumb!.height).toBe(800 / 600)
  })
})
