// The files of a post Slack has not got (architecture 9, "Upload"; OUT-7 in docs/state-machines.md): a post
// deleted after its files were uploaded and completed, but before `files.share`, would leave them in Slack as
// private files no message shows. Juno deletes them with `files.delete`, through a persisted row the action
// worker retries, and a repeat that finds the file gone (`file_deleted`) is done. Every test starts warm on the
// synced default workspace.
import { expect, it } from 'bun:test'
import { attachFiles, attachmentsAtom, clearAttachments, discardMessage, readyFiles, sendMessage } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { eng, MAIN, outboxScenario, rowWith, type Watch } from '../outboxScenario'
import { apiCalls, quiet, readDb, valueOf } from '../scenario'

const { booted, opened } = outboxScenario()

const notes = () => new File(['Freeze starts Thursday.\n'], 'notes.txt', { type: 'text/plain' })

/** The rows that still ask Slack to delete a file. */
const fileDeleteRows = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare(`SELECT target_key FROM outbox WHERE kind = 'deleteFile'`).all() as Array<{ target_key: string }>)

/**
 * A post with one file whose upload completed and whose share Slack refused: it waits, failed, with the
 * file's id on its row. Answers the post's client id and the file's id in Slack.
 */
async function failedAfterUpload(engine: RunningEngine, rows: Watch, text: string) {
  clearAttachments(engine.registry, MAIN)
  await attachFiles(engine.registry, MAIN, [notes()])
  const ids = readyFiles(engine.registry, MAIN)!
  engine.fake.forceError({ method: 'files.share', error: 'restricted_action' })
  valueOf(await sendMessage(engine.registry, eng, text, MAIN, ids))
  const failed = rowWith(await rows((list) => rowWith(list, text)?.pending === 'failed', `"${text}" failed`), text)!
  const fileId = [...engine.fake.workspace.files.values()].find((file) => file.name === 'notes.txt')!.id
  expect(apiCalls(engine, 'files.completeUpload').map((call) => call.ok)).toEqual([true])
  return { clientMsgId: failed.clientMsgId!, fileId }
}

it('deletes the uploaded file of a post the user deletes before Slack shares it', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  const unmount = engine.registry.mount(attachmentsAtom(MAIN))
  try {
    const { clientMsgId, fileId } = await failedAfterUpload(engine, rows, 'Never shared')
    valueOf(await discardMessage(engine.registry, clientMsgId))
    await rows((list) => rowWith(list, 'Never shared') === undefined, 'the post gone from the list')
    await waitFor(() => (engine.fake.workspace.files.has(fileId) ? undefined : true), WAIT_MS, 'the file deleted in Slack')
    await quiet(engine)
    expect(apiCalls(engine, 'files.delete').map((call) => [call.args['file'], call.ok])).toEqual([[fileId, true]])
    expect(fileDeleteRows(engine)).toEqual([])
    expect(engine.fake.workspace.files.has(fileId)).toBe(false)
  } finally {
    unmount()
  }
})

it('ends the delete when its first answer is lost and the retry hears file_deleted', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  const unmount = engine.registry.mount(attachmentsAtom(MAIN))
  try {
    const { clientMsgId, fileId } = await failedAfterUpload(engine, rows, 'Lost delete answer')
    // Slack deletes the file, and the answer never comes: the retry finds the file already gone.
    engine.fake.loseResponse({ method: 'files.delete' })
    valueOf(await discardMessage(engine.registry, clientMsgId))
    await waitFor(() => (apiCalls(engine, 'files.delete').length >= 2 ? true : undefined), WAIT_MS, 'the delete retried')
    await waitFor(() => (fileDeleteRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    await quiet(engine)
    expect(apiCalls(engine, 'files.delete').map((call) => [call.args['file'], call.error])).toEqual([[fileId, 'lost'], [fileId, 'file_deleted']])
    expect(engine.fake.workspace.files.has(fileId)).toBe(false)
  } finally {
    unmount()
  }
})

// The other side: Slack shares the file and posts the message, the answer is lost, and the channel is archived
// before the lookup asks, so the row fails with Slack's refusal of the lookup. Slack may show the message, so
// Delete draft must not delete the file people can still open in it.
it('keeps the file of a post Slack may show when its lookup is refused because the channel was archived', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  const unmount = engine.registry.mount(attachmentsAtom(MAIN))
  try {
    clearAttachments(engine.registry, MAIN)
    await attachFiles(engine.registry, MAIN, [notes()])
    const ids = readyFiles(engine.registry, MAIN)!
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'files.share' })
    engine.fake.forceError({ method: 'conversations.history', error: 'is_archived', times: 50 })
    valueOf(await sendMessage(engine.registry, eng, 'Shared, then archived', MAIN, ids))
    const failed = rowWith(await rows((list) => rowWith(list, 'Shared, then archived')?.pending === 'failed', 'the post failed'), 'Shared, then archived')!
    const fileId = [...engine.fake.workspace.files.values()].find((file) => file.name === 'notes.txt')!.id
    valueOf(await discardMessage(engine.registry, failed.clientMsgId!))
    await rows((list) => rowWith(list, 'Shared, then archived') === undefined, 'the post gone from the list')
    await quiet(engine)
    expect(apiCalls(engine, 'files.share').map((call) => call.error)).toEqual(['lost'])
    expect(apiCalls(engine, 'files.delete')).toEqual([])
    expect(fileDeleteRows(engine)).toEqual([])
    expect(engine.fake.workspace.files.has(fileId)).toBe(true)
    engine.fake.releaseFrames({ drop: true })
  } finally {
    unmount()
  }
})
