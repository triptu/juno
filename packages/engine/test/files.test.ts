// Sending files (spec section 8; architecture 9 and 5.7): staged files go
// with the message through the outbox, as the official client sends them
// (files.getUploadURL, the bytes, files.completeUpload, then files.share),
// show in the pending row at the size the stored message will have, and a
// failed upload waits for Retry without losing the text or the files.
import { afterEach, describe, expect, it } from 'vitest'
import type { FileView, MessageView } from '@juno/contract'
import { samplePng } from '@juno/fake-slack'
import { attachFiles, attachmentsAtom, messagesAtom, readyFiles, retryMessage, sendMessage, uploadProgressAtom, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet, readDb, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const MAIN = 'm:C0ENG'
const eng = { kind: 'channel', channelId: 'C0ENG' } as const

const booted = async () => {
  const engine = await bootedEngine(engines)
  await quiet(engine)
  engine.fake.resetCalls()
  return engine
}

function watch(engine: RunningEngine, topicId: string) {
  const atom = messagesAtom(topicId)
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<MessageView> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  return (predicate: (rows: ReadonlyArray<MessageView>) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      const rows = window?.order.map((id) => window.rows.get(id)!)
      return rows !== undefined && predicate(rows) ? rows : undefined
    }, WAIT_MS, label)
}

const chart = () => new File([samplePng(800, 600)], 'chart.png', { type: 'image/png' })
const notes = () => new File(['Freeze starts Thursday.\n'], 'notes.txt', { type: 'text/plain' })

/** Attaches `files` to #eng's Main composer and answers their staged ids once every one is staged. */
async function attach(engine: RunningEngine, files: ReadonlyArray<File>): Promise<ReadonlyArray<string>> {
  unmounts.push(engine.registry.mount(attachmentsAtom(MAIN)))
  await attachFiles(engine.registry, MAIN, files)
  const ready = readyFiles(engine.registry, MAIN)
  expect(ready).toHaveLength(files.length)
  return ready!
}

const withFiles = (row: MessageView) => row.files.length > 0 && row.files.every((file) => file.name !== '')
const shape = (file: FileView) => ({ name: file.name, kind: file.kind, box: file.thumb === undefined ? undefined : [file.thumb.width, file.thumb.height] })

describe('files', () => {
  it('stages files, shows them in the pending row and sends them with the text in one message', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    const staged = engine.registry.get(attachmentsAtom(MAIN))
    expect(staged).toEqual([])
    const ids = await attach(engine, [chart(), notes()])
    expect(engine.registry.get(attachmentsAtom(MAIN)).map((file) => ({ name: file.name, state: file.state, preview: file.preview?.startsWith('juno://uploads/') }))).toEqual([
      { name: 'chart.png', state: 'ready', preview: true },
      { name: 'notes.txt', state: 'ready', preview: undefined },
    ])

    engine.fake.holdNext({ method: 'files.share', before: true })
    valueOf(await sendMessage(engine.registry, eng, 'The numbers for Thursday', MAIN, ids))
    const pending = (await rows((list) => list.some((row) => row.pending !== undefined && withFiles(row)), 'the pending row')).find((row) => row.pending !== undefined)!
    expect(pending.files.map(shape)).toEqual([
      { name: 'chart.png', kind: 'image', box: [360, 270] },
      { name: 'notes.txt', kind: 'file', box: undefined },
    ])
    expect(pending.files[0]!.thumb!.src).toMatch(/^juno:\/\/uploads\/[0-9a-f-]+\.png$/)

    engine.fake.release()
    const settled = await rows((list) => list.some((row) => row.clientMsgId === pending.clientMsgId && row.pending === undefined), 'the message stored')
    const stored = settled.find((row) => row.clientMsgId === pending.clientMsgId)!
    // The stored message reserves the same box as the pending row, so the swap moves nothing.
    expect(stored.files.map(shape)).toEqual(pending.files.map(shape))
    expect(stored.files[0]!.thumb!.src).toMatch(/^juno:\/\/files\//)
    expect(stored.files[1]!.download).toBeDefined()

    expect(apiCalls(engine, 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['chart.png', 'notes.txt'])
    expect(apiCalls(engine, 'files.completeUpload')).toHaveLength(2)
    const shares = apiCalls(engine, 'files.share')
    expect(shares).toHaveLength(1)
    expect(shares[0]!.args['client_msg_id']).toBe(pending.clientMsgId)
    expect(engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === pending.clientMsgId).map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png', 'notes.txt']])
    expect(apiCalls(engine, 'chat.postMessage')).toEqual([])
  })

  it('keeps a failed upload with its text for Retry, and uploads each file once', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    const ids = await attach(engine, [notes(), chart()])
    // The first file goes up; the second one's bytes are refused.
    engine.fake.failUploads({ times: 1, after: 1 })
    valueOf(await sendMessage(engine.registry, eng, 'With the chart', MAIN, ids))
    const failed = (await rows((list) => list.some((row) => row.pending === 'failed'), 'the failed row')).find((row) => row.pending === 'failed')!
    expect(failed.files.map((file) => file.name)).toEqual(['notes.txt', 'chart.png'])
    expect(readDb(engine, 'user.db', (db) => (db.prepare('SELECT text, last_error FROM pending_messages WHERE client_msg_id = ?').get(failed.clientMsgId!) as object))).toEqual({
      text: 'With the chart',
      last_error: 'upload_failed_500',
    })
    expect(apiCalls(engine, 'files.share')).toEqual([])

    valueOf(await retryMessage(engine.registry, failed.clientMsgId!))
    await rows((list) => list.some((row) => row.clientMsgId === failed.clientMsgId && row.pending === undefined), 'sent after Retry')
    await quiet(engine)
    expect(apiCalls(engine, 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['notes.txt', 'chart.png', 'chart.png'])
    expect(apiCalls(engine, 'files.share')).toHaveLength(1)
    expect(engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === failed.clientMsgId)).toHaveLength(1)
  })

  it('reports upload progress while a post uploads, and nothing once it is sent', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    unmounts.push(engine.registry.mount(uploadProgressAtom))
    const ids = await attach(engine, [notes(), chart()])
    engine.fake.holdNext({ method: 'files.share', before: true })
    valueOf(await sendMessage(engine.registry, eng, '', MAIN, ids))
    const progress = () => {
      const result = engine.registry.get(uploadProgressAtom)
      return result._tag === 'Success' ? result.value : undefined
    }
    await waitFor(() => (Object.values(progress() ?? {}).includes(1) ? true : undefined), WAIT_MS, 'uploads done')
    engine.fake.release()
    await waitFor(() => (progress() !== undefined && Object.keys(progress()!).length === 0 ? true : undefined), WAIT_MS, 'progress cleared')
  })
})
