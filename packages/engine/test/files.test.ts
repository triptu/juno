// Sending files (spec section 8; architecture 9 and 5.7): staged files go
// with the message through the outbox, as the official client sends them
// (files.getUploadURL, the bytes, files.completeUpload, then files.share),
// show in the pending row at the size the stored message will have, and a
// failed upload waits for Retry without losing the text or the files.
import { afterEach, describe, expect, it } from 'vitest'
import type { FileView, MessageView } from '@juno/contract'
import { samplePng } from '@juno/fake-slack'
import { attachFiles, attachmentsAtom, messagesAtom, openTopic, readyFiles, retryMessage, sendMessage, uploadProgressAtom, type ListWindow } from '@juno/state'
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
      { name: 'notes.txt', kind: 'text', box: undefined },
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

describe('files: a copy the network made', () => {
  it('hides a copy of a post with files and keeps it in Slack, since deleting it may remove the file', async () => {
    const engine = await booted()
    engine.main.network.resend = true
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    const ids = await attach(engine, [notes()])
    engine.fake.loseResponse({ method: 'files.share' })
    valueOf(await sendMessage(engine.registry, eng, 'Notes for the freeze', MAIN, ids))
    const id = await waitFor(() => apiCalls(engine, 'files.share')[0]?.args['client_msg_id'] as string | undefined, WAIT_MS, 'the share')
    const stored = () => readDb(engine, 'cache.db', (db) => (db.prepare('SELECT count(*) AS n FROM messages WHERE client_msg_id = ?').get(id) as { n: number }).n)
    await waitFor(() => (stored() === 2 ? true : undefined), WAIT_MS, 'both copies stored')
    await quiet(engine)
    const shown = await rows((list) => list.some((row) => row.clientMsgId === id && row.pending === undefined), 'the message shown')
    expect(shown.filter((row) => row.clientMsgId === id)).toHaveLength(1)
    expect(readDb(engine, 'user.db', (db) => db.prepare('SELECT reason, hidden FROM kept_copies').all())).toEqual([{ reason: 'file copy kept until verified', hidden: 1 }])
    expect(apiCalls(engine, 'chat.delete')).toEqual([])
    expect(engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === id)).toHaveLength(2)
  })

  it('gives a PDF, an HTML page and text a content url, text how to draw it, and audio and a voice clip a player url', async () => {
    const engine = await booted()
    const at = (id: string, name: string) => `${engine.fake.url}/files/${id}/${name}`
    const files = [
      { id: 'F0PDF', name: 'q4-plan.pdf', mimetype: 'application/pdf', filetype: 'pdf', size: 52_000, url_private: at('F0PDF', 'q4-plan.pdf') },
      { id: 'F0HTML', name: 'newsletter.html', mimetype: 'text/html', filetype: 'html', url_private: at('F0HTML', 'newsletter.html') },
      { id: 'F0NOTE', name: 'notes.md', title: 'Release notes', mimetype: 'text/plain', filetype: 'markdown', mode: 'snippet', lines: 40, preview: '# Release', preview_is_truncated: true, url_private: at('F0NOTE', 'notes.md') },
      { id: 'F0CSV', name: 'export.csv', mimetype: 'text/csv', filetype: 'csv', url_private: at('F0CSV', 'export.csv') },
      { id: 'F0JSON', name: 'config.json', mimetype: 'application/json', filetype: 'json', url_private: at('F0JSON', 'config.json') },
      { id: 'F0PY', name: 'fix.py', mimetype: 'text/plain', filetype: 'python', pretty_type: 'Python', mode: 'snippet', url_private: at('F0PY', 'fix.py') },
      { id: 'F0LOG', name: 'deploy.log', mimetype: 'text/plain', filetype: 'text', url_private: at('F0LOG', 'deploy.log') },
      { id: 'F0MP3', name: 'standup.mp3', mimetype: 'audio/mpeg', filetype: 'mp3', duration_ms: 300_000, url_private: at('F0MP3', 'standup.mp3') },
      { id: 'F0VOICE', name: 'audio_message.m4a', mimetype: 'audio/mp4', filetype: 'm4a', subtype: 'slack_audio', duration_ms: 12_000, aac: at('F0VOICE', 'audio_message.aac'), url_private: at('F0VOICE', 'audio_message.m4a') },
      { id: 'F0ZIP', name: 'logs.zip', mimetype: 'application/zip', filetype: 'zip', url_private: at('F0ZIP', 'logs.zip'), url_private_download: `${at('F0ZIP', 'logs.zip')}?download=1` },
    ]
    const posted = engine.fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0JONAS', text: 'Files from the review', files, silent: true })
    valueOf(await openTopic(engine.registry, 'm:C0INCIDENTS'))
    const rows = await watch(engine, 'm:C0INCIDENTS')((list) => list.some((row) => row.ts === posted.ts && row.files.length === files.length), 'the files')
    const byId = new Map(rows.find((row) => row.ts === posted.ts)!.files.map((file) => [file.id, file]))
    const content = (id: string) => {
      const file = files.find((each) => each.id === id)!
      return `juno://files/${id}/content/${encodeURIComponent(file.name)}?url=${encodeURIComponent(file.url_private)}`
    }
    expect(byId.get('F0PDF')).toMatchObject({ kind: 'pdf', content: content('F0PDF') })
    expect(byId.get('F0HTML')).toMatchObject({ kind: 'html', content: content('F0HTML') })
    expect(byId.get('F0NOTE')).toMatchObject({ kind: 'text', name: 'Release notes', textKind: 'markdown', lines: 40, content: content('F0NOTE') })
    expect(byId.get('F0CSV')).toMatchObject({ kind: 'text', textKind: 'csv' })
    expect(byId.get('F0JSON')).toMatchObject({ kind: 'text', textKind: 'json' })
    expect(byId.get('F0PY')).toMatchObject({ kind: 'text', textKind: 'code', language: 'Python' })
    expect(byId.get('F0LOG')).toMatchObject({ kind: 'text', textKind: 'plain' })
    expect(byId.get('F0MP3')).toMatchObject({ kind: 'audio', durationMs: 300_000, audio: `juno://files/F0MP3/audio?url=${encodeURIComponent(at('F0MP3', 'standup.mp3'))}` })
    expect(byId.get('F0VOICE')).toMatchObject({ kind: 'audio', durationMs: 12_000, audio: `juno://files/F0VOICE/audio?url=${encodeURIComponent(at('F0VOICE', 'audio_message.aac'))}` })
    const zip = byId.get('F0ZIP')!
    expect(zip).toMatchObject({ kind: 'file', download: files[9]!.url_private_download })
    expect(zip.content).toBeUndefined()
    for (const file of byId.values()) expect(file.thumb).toBeUndefined()
  })
})
