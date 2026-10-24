// Copies the network makes of a post (ADR 0014, specs/outbox.qnt): Chromium sends a request again when its
// reused connection closes with no answer. Juno deletes the copy, checks that delete again just before it
// goes out and, after a gap, only once the recheck has read the copy's topic; Slack always keeps at least one
// copy. Files go with their message, and a copy that carries files is hidden and kept. Cases found by the
// conformance replay (test/conformance) and the 2026-10-17 correctness review say so. Every test starts warm
// on the synced default workspace.
import { expect, it } from 'bun:test'
import type { FileView, MessageView } from '@juno/contract'
import { samplePng } from '@juno/fake-slack'
import { attachFiles, attachmentsAtom, clearAttachments, deleteMessage, openTopic, readyFiles, retryMessage, sendMessage, uploadProgressAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { actionRows, copies, eng, fresh, MAIN, outboxScenario, post, rowWith, settled, textOf, type Watch } from '../outboxScenario'
import { apiCalls, quiet, valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened, closeWindows } = outboxScenario()

/** The row Slack's copy of the post is shown as, once settled. */
const shownAs = async (rows: Watch, text: string) => rowWith(await rows(settled(text), `"${text}" settled`), text)!

it('deletes a copy the network made of a post, and keeps two sends of the same text and another person’s message', async () => {
  const engine = await booted()
  engine.main.network.resend = true
  const rows = await opened(engine)

  await step('deletes the copy and keeps the one stored first', async () => {
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await post(engine, 'Sent over a closed connection')
    const kept = await shownAs(rows, 'Sent over a closed connection')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(2)
    expect(copies(engine, id)).toBe(2)
    // The echo of the first copy arrives after the answer to the second.
    engine.fake.releaseFrames()
    await waitFor(() => (copies(engine, id) === 1 ? true : undefined), WAIT_MS, 'the copy deleted')
    await quiet(engine)
    await rows(settled('Sent over a closed connection'), 'one row')
    expect<unknown>(engine.fake.messages('C0ENG').find((m) => m.client_msg_id === id)!.ts).toBe(kept.ts)
    expect(apiCalls(engine, 'chat.delete')).toHaveLength(1)
  })

  await step('keeps two sends of the same text, and a message another person posts with the same id', async () => {
    await fresh(engine)
    const first = await post(engine, 'Same words twice')
    await rows((list) => list.some((row) => textOf(row) === 'Same words twice' && row.pending === undefined), 'the first stored')
    await post(engine, 'Same words twice')
    await rows((list) => list.filter((row) => textOf(row) === 'Same words twice' && row.pending === undefined).length === 2, 'both stored')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Not a copy', clientMsgId: first })
    await rows((list) => rowWith(list, 'Not a copy') !== undefined, 'the other message stored')
    await quiet(engine)
    expect(engine.fake.messages('C0ENG').filter((m) => m.text === 'Same words twice')).toHaveLength(2)
    expect(copies(engine, first)).toBe(2)
    expect(apiCalls(engine, 'chat.delete')).toHaveLength(0)
  })
})

/**
 * A post the network sent twice, the copy's delete refused for its first `failures` tries (Slack's own
 * trouble, retried with backoff). Answers the client id, the kept message and the copy's ts.
 */
async function copyWithSlowDelete(engine: RunningEngine, rows: Watch, text: string, failures: number) {
  engine.main.network.resend = true
  engine.fake.holdFrames({ types: ['message'] })
  engine.fake.loseResponse({ method: 'chat.postMessage' })
  const id = await post(engine, text)
  const kept = (await shownAs(rows, text)).ts
  const copy = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === id && m.ts !== kept)!.ts
  engine.fake.forceError({ method: 'chat.delete', error: 'internal_error', times: failures })
  engine.fake.releaseFrames()
  await waitFor(() => (apiCalls(engine, 'chat.delete').length > 0 ? true : undefined), WAIT_MS, 'the first delete refused')
  return { id, kept, copy }
}

// Review 2026-10-17 (docs/reviews/2026-10-17-correctness.md): the copy's delete was decided once, when the
// copy was stored, and not checked again before it went out. Slack must keep at least one copy.
it('checks a copy’s delete again before it goes out, and keeps the copy when the kept message changed meanwhile', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('keeps a copy that another person replied to while its delete waited', async () => {
    const { copy } = await copyWithSlowDelete(engine, rows, 'Copy that gets a reply', 3)
    // Other people's clients show both messages until the delete lands. Maya replies to the copy.
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Replying to the copy', threadTs: copy })
    await engine.socketIdle()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete settled')
    // ADR 0014: "A copy that has replies is left alone." A deleted root with replies would be a tombstone.
    expect(engine.fake.messages('C0ENG').find((m) => m.ts === copy)?.subtype).toBeUndefined()
  })

  await step('keeps the copy when the user deletes the kept message on another device while the delete waits', async () => {
    await fresh(engine)
    const { id, kept } = await copyWithSlowDelete(engine, rows, 'Deleted on the phone', 3)
    // On the phone the user sees two messages and deletes one of them: the one Juno kept.
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: kept })
    await engine.socketIdle()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete settled')
    // The user meant to keep one message. Juno deleting the other would leave none.
    expect(copies(engine, id)).toBe(1)
  })

  // Found by the conformance replay: the check ran before the call waited for the send lane, which runs one
  // write at a time, so a change made during that wait was not seen. The check now runs holding the lane.
  await step('keeps the copy when the kept message is deleted while the copy’s delete waits behind a slow post', async () => {
    await fresh(engine)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await post(engine, 'Copy behind a slow post')
    const kept = (await shownAs(rows, 'Copy behind a slow post')).ts
    engine.main.network.resend = false
    // A post to #product that Slack is slow to answer holds the send lane.
    engine.fake.gate((method, args) => method === 'chat.postMessage' && args['channel'] === 'C0PRODUCT')
    valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'C0PRODUCT' }, 'A slow post', 'm:C0PRODUCT'))
    await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the slow post at Slack')
    // The copy's echo arrives: it is hidden, its delete is checked and waits for the lane.
    const ready = engine.actionsReady()
    engine.fake.releaseFrames()
    await waitFor(() => (engine.actionsReady() > ready ? true : undefined), WAIT_MS, 'the copy delete passed preflight')
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: kept })
    await rows((list) => !list.some((row) => row.ts === kept), 'the delete from the phone stored')
    engine.fake.gate(undefined)
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete settled')
    expect(copies(engine, id)).toBe(1)
  })

  // Found by the conformance replay: the check could not tell the user's own delete from one made on another device.
  await step('deletes the copy too when the user deletes the message before Juno has seen its copy', async () => {
    await fresh(engine)
    engine.main.network.resend = true
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await post(engine, 'Deleted by its sender')
    const kept = await shownAs(rows, 'Deleted by its sender')
    engine.main.network.resend = false
    valueOf(await deleteMessage(engine.registry, { channelId: 'C0ENG', ts: kept.ts, clientMsgId: id }))
    await waitFor(() => (copies(engine, id) === 1 ? true : undefined), WAIT_MS, 'the message deleted in Slack')
    engine.fake.releaseFrames()
    await engine.socketIdle()
    await engine.workPass('action')
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete settled')
    // The user meant the message gone: Slack keeps no copy of it, and Juno shows none.
    expect(copies(engine, id)).toBe(0)
    await rows((list) => !list.some((row) => row.clientMsgId === id), 'none shown')
  })

  await step('deletes a copy across a reconnect once the recheck has read its channel', async () => {
    await fresh(engine)
    const { id } = await copyWithSlowDelete(engine, rows, 'Sent before the drop, then rechecked', 2)
    engine.fake.dropSocket()
    await waitFor(() => (copies(engine, id) === 1 ? true : undefined), WAIT_MS, 'the copy deleted')
    expect(apiCalls(engine, 'conversations.history').some((call) => call.args['_x_reason'] === 'recheck' && call.args['channel'] === 'C0ENG')).toBe(true)
  })
})

// A post sent before a gap may have had its kept message deleted during the gap, which no event reports.
// Mutation repair never certifies outbox coverage; only a fallback recheck can.
it('keeps a copy across a reconnect when no recheck reads its channel', async () => {
  const engine = await booted({ recheckTopics: 0 })
  const rows = await opened(engine)

  await step('keeps both copies when the recheck does not read the channel', async () => {
    const { id } = await copyWithSlowDelete(engine, rows, 'Sent before the drop', 5)
    closeWindows()
    const reconnected = engine.nextSync()
    engine.fake.dropSocket()
    await reconnected
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete dropped')
    expect(copies(engine, id)).toBe(2)
    expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'recheck')).toBe(false)
  })

  await step('keeps the surviving copy when the mutation markers find the original deleted offline', async () => {
    await fresh(engine)
    const rows = await opened(engine)
    const { id, kept } = await copyWithSlowDelete(engine, rows, 'Original deleted offline', 5)
    closeWindows()
    engine.fake.goOffline()
    await engine.phase('offline')
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: kept })
    engine.fake.goOnline()
    await engine.phase('live', WAIT_MS)
    await engine.syncIdle()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete dropped')
    expect(copies(engine, id)).toBe(1)
    expect(apiCalls(engine, 'conversations.history').some((c) => c.args['_x_reason'] === 'mutation-repair')).toBe(true)
    expect(engine.fake.calls.some((c) => c.args['_x_reason'] === 'recheck')).toBe(false)
    const survivor = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === id)!
    await watch(engine, MAIN)((list) => list.some((row) => row.ts === survivor.ts) && !list.some((row) => row.ts === kept), 'the survivor shown')
  })
})

const chart = () => new File([samplePng(800, 600)], 'chart.png', { type: 'image/png' })
const notes = () => new File(['Freeze starts Thursday.\n'], 'notes.txt', { type: 'text/plain' })
const shape = (file: FileView) => ({ name: file.name, kind: file.kind, box: file.thumb === undefined ? undefined : [file.thumb.width, file.thumb.height] })
const withFiles = (row: MessageView) => row.files.length > 0 && row.files.every((file) => file.name !== '')

// Spec section 8; architecture 9: staged files go with the message as the official client sends them
// (files.getUploadURL, the bytes, files.completeUpload, then files.share).
it('sends files with their message, uploads each file once across Retry, and keeps a copy that carries files', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  const unmount = engine.registry.mount(attachmentsAtom(MAIN))
  // The composer clears what it sent, as the renderer's attachments container does.
  const attach = async (files: ReadonlyArray<File>) => {
    clearAttachments(engine.registry, MAIN)
    await attachFiles(engine.registry, MAIN, files)
    const ready = readyFiles(engine.registry, MAIN)
    expect(ready).toHaveLength(files.length)
    return ready!
  }

  try {
    await step('shows staged files in the pending row at the size the stored message keeps, and sends them with the text', async () => {
      const progressUnmount = engine.registry.mount(uploadProgressAtom)
      const progress = () => {
        const result = engine.registry.get(uploadProgressAtom)
        return result._tag === 'Success' ? result.value : undefined
      }
      const ids = await attach([chart(), notes()])
      expect(engine.registry.get(attachmentsAtom(MAIN)).map((file) => [file.name, file.state])).toEqual([['chart.png', 'ready'], ['notes.txt', 'ready']])
      engine.fake.holdNext({ method: 'files.share', before: true })
      valueOf(await sendMessage(engine.registry, eng, 'The numbers for Thursday', MAIN, ids))
      const pending = (await rows((list) => list.some((row) => row.pending !== undefined && withFiles(row)), 'the pending row')).find((row) => row.pending !== undefined)!
      expect(pending.files.map(shape)).toEqual([
        { name: 'chart.png', kind: 'image', box: [360, 270] },
        { name: 'notes.txt', kind: 'text', box: undefined },
      ])
      await waitFor(() => (Object.values(progress() ?? {}).includes(1) ? true : undefined), WAIT_MS, 'uploads done')
      engine.fake.release()
      const stored = (await rows((list) => list.some((row) => row.clientMsgId === pending.clientMsgId && row.pending === undefined), 'the message stored')).find((row) => row.clientMsgId === pending.clientMsgId)!
      // The stored message reserves the same box as the pending row, so the swap moves nothing.
      expect(stored.files.map(shape)).toEqual(pending.files.map(shape))
      await waitFor(() => (progress() !== undefined && Object.keys(progress()!).length === 0 ? true : undefined), WAIT_MS, 'progress cleared')
      progressUnmount()
      expect(apiCalls(engine, 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['chart.png', 'notes.txt'])
      expect(apiCalls(engine, 'files.share').map((call) => call.args['client_msg_id'])).toEqual([pending.clientMsgId])
      expect(engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === pending.clientMsgId).map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png', 'notes.txt']])
      expect(apiCalls(engine, 'chat.postMessage')).toEqual([])
    })

    await step('keeps a failed upload with its text for Retry, and uploads each file once', async () => {
      await fresh(engine)
      const ids = await attach([notes(), chart()])
      // The first file goes up; the second one's bytes are refused.
      engine.fake.failUploads({ times: 1, after: 1 })
      valueOf(await sendMessage(engine.registry, eng, 'With the chart', MAIN, ids))
      const failed = (await rows((list) => list.some((row) => row.pending === 'failed'), 'the failed row')).find((row) => row.pending === 'failed')!
      expect([textOf(failed), failed.files.map((file) => file.name)]).toEqual(['With the chart', ['notes.txt', 'chart.png']])
      expect(apiCalls(engine, 'files.share')).toEqual([])
      valueOf(await retryMessage(engine.registry, failed.clientMsgId!))
      await rows((list) => list.some((row) => row.clientMsgId === failed.clientMsgId && row.pending === undefined), 'sent after Retry')
      await quiet(engine)
      expect(apiCalls(engine, 'files.getUploadURL').map((call) => call.args['filename'])).toEqual(['notes.txt', 'chart.png', 'chart.png'])
      expect(apiCalls(engine, 'files.share')).toHaveLength(1)
      expect(copies(engine, failed.clientMsgId!)).toBe(1)
    })

    // ADR 0014: deleting a copy that carries files may remove the file, so it is hidden and kept.
    await step('hides a copy the network made of a post with files, and keeps it in Slack', async () => {
      await fresh(engine)
      engine.main.network.resend = true
      const ids = await attach([notes()])
      engine.fake.loseResponse({ method: 'files.share' })
      valueOf(await sendMessage(engine.registry, eng, 'Notes for the freeze', MAIN, ids))
      const id = await waitFor(() => apiCalls(engine, 'files.share')[0]?.args['client_msg_id'], WAIT_MS, 'the share')
      await waitFor(() => (copies(engine, id) === 2 ? true : undefined), WAIT_MS, 'both copies in Slack')
      await quiet(engine)
      const shown = await rows((list) => list.some((row) => row.clientMsgId === id && row.pending === undefined), 'the message shown')
      expect(shown.filter((row) => row.clientMsgId === id)).toHaveLength(1)
      expect(apiCalls(engine, 'chat.delete')).toEqual([])
      expect(copies(engine, id)).toBe(2)
    })
  } finally {
    unmount()
  }
})

it('shows each kind of file someone else posts as something Juno can open, play or download', async () => {
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
  const shown = Object.fromEntries(rows.find((row) => row.ts === posted.ts)!.files.map((file) => [file.id, {
    kind: file.kind,
    ...(file.textKind === undefined ? {} : { textKind: file.textKind }),
    ...(file.language === undefined ? {} : { language: file.language }),
    ...(file.durationMs === undefined ? {} : { durationMs: file.durationMs }),
    opens: file.content !== undefined,
    plays: file.audio !== undefined,
    downloads: file.download !== undefined,
    thumb: file.thumb !== undefined,
  }]))
  expect(shown).toMatchObject({
    F0PDF: { kind: 'pdf', opens: true },
    F0HTML: { kind: 'html', opens: true },
    F0NOTE: { kind: 'text', textKind: 'markdown', opens: true },
    F0CSV: { kind: 'text', textKind: 'csv' },
    F0JSON: { kind: 'text', textKind: 'json' },
    F0PY: { kind: 'text', textKind: 'code', language: 'Python' },
    F0LOG: { kind: 'text', textKind: 'plain' },
    F0MP3: { kind: 'audio', durationMs: 300_000, plays: true },
    F0VOICE: { kind: 'audio', durationMs: 12_000, plays: true },
    F0ZIP: { kind: 'file', opens: false, downloads: true },
  })
  // A voice clip plays Slack's AAC rendition.
  expect(rows.find((row) => row.ts === posted.ts)!.files.find((file) => file.id === 'F0VOICE')!.audio).toContain(encodeURIComponent(at('F0VOICE', 'audio_message.aac')))
  expect(Object.values(shown).some((file) => file.thumb)).toBe(false)
})
