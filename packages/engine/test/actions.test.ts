// Edits and deletes through the outbox (M6b; architecture 5.7,
// specs/outbox.qnt): the change shows at once, Slack's answer and the socket
// event reconcile it in either order, a message still being sent is waited
// for (`depends_on`), and a refusal puts back what Slack has. Reactions are
// in `reactions.test.ts`.
import { describe, expect, it } from 'vitest'
import { deleteMessage, editMessage, sendMessage } from '@juno/state'
import { waitFor, WAIT_MS } from './harness'
import { apiCalls, errorOf, quiet, readDb, valueOf } from './scenario'
import { actionRows, booted, eng, inSlack, MAIN, refOf, restarted, rowWith, sent, stopEnginesAfterEach, watch } from './actionScenario'

stopEnginesAfterEach()

describe('edit', () => {
  it('shows the new text at once; the answer and then the echo leave it as it is', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Shipping Tuesday', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(engine.registry, refOf(message), 'Shipping Wednesday'))
    const shown = await rows((list) => rowWith(list, 'Shipping Wednesday')?.edited === true, 'the edit shown')
    expect(rowWith(shown, 'Shipping Tuesday')).toBeUndefined()
    expect(inSlack(engine, message.ts)?.text).toBe('Shipping Tuesday')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    expect(inSlack(engine, message.ts)?.text).toBe('Shipping Wednesday')
    engine.fake.releaseFrames()
    await quiet(engine)
    const after = await rows((list) => rowWith(list, 'Shipping Wednesday')?.edited === true, 'still edited')
    expect(after.filter((row) => row.ts === message.ts)).toHaveLength(1)
    expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
  })

  it('keeps the edit when the echo comes before the answer', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Lunch at noon', rows)
    engine.fake.holdNext({ method: 'chat.update' })
    valueOf(await editMessage(engine.registry, refOf(message), 'Lunch at one'))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the held answer')
    // Slack has run the call and its echo is stored; the row still holds the intent.
    await waitFor(() => (readDb(engine, 'cache.db', (db) => (db.prepare('SELECT text FROM messages WHERE ts = ?').get(message.ts) as { text: string }).text) === 'Lunch at one' ? true : undefined), WAIT_MS, 'the echo stored')
    expect(actionRows(engine)).toHaveLength(1)
    await rows((list) => rowWith(list, 'Lunch at one')?.edited === true, 'shown edited')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    await rows((list) => rowWith(list, 'Lunch at one')?.edited === true, 'still edited')
  })

  it('holds the user’s edit over another client’s edit that lands while it is out', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Draft one', rows)
    engine.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(engine.registry, refOf(message), 'Draft three'))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the held call')
    engine.fake.editMessage({ channel: 'C0ENG', ts: message.ts, text: 'Draft two' })
    await quiet(engine)
    const during = await rows((list) => rowWith(list, 'Draft three') !== undefined, 'the intent shown')
    expect(rowWith(during, 'Draft two')).toBeUndefined()
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    await rows((list) => rowWith(list, 'Draft three') !== undefined, 'Slack’s last edit is the user’s')
    expect(inSlack(engine, message.ts)?.text).toBe('Draft three')
  })

  it('sends again after a lost answer, and Slack ends with the text once', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Retro at 3', rows)
    engine.fake.loseResponse({ method: 'chat.update', times: 3 })
    valueOf(await editMessage(engine.registry, refOf(message), 'Retro at 4'))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), 30_000, 'the row ended')
    expect(inSlack(engine, message.ts)?.text).toBe('Retro at 4')
    await rows((list) => rowWith(list, 'Retro at 4')?.edited === true, 'shown edited')
  })

  it('goes back to Slack’s text when Slack refuses the edit', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Too late to change', rows)
    engine.fake.forceError({ method: 'chat.update', error: 'edit_window_closed' })
    valueOf(await editMessage(engine.registry, refOf(message), 'Changed anyway'))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    const after = await rows((list) => rowWith(list, 'Too late to change') !== undefined, 'the original back')
    expect(rowWith(after, 'Changed anyway')).toBeUndefined()
    expect(rowWith(after, 'Too late to change')?.edited).toBe(false)
  })

  it('waits for a message still being sent, then edits it by its new ts', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    valueOf(await sendMessage(engine.registry, eng, 'Typo in thsi', MAIN))
    const pending = rowWith(await rows((list) => rowWith(list, 'Typo in thsi')?.pending === 'sending', 'sending'), 'Typo in thsi')!
    valueOf(await editMessage(engine.registry, refOf(pending), 'Typo in this'))
    await rows((list) => rowWith(list, 'Typo in this')?.pending === 'sending', 'the edit shown on the pending row')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the edit sent')
    const posted = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)!
    expect(posted.text).toBe('Typo in this')
    expect(apiCalls(engine, 'chat.update')[0]!.args['ts']).toBe(posted.ts)
    const after = await rows((list) => rowWith(list, 'Typo in this')?.pending === undefined, 'stored')
    expect(after.filter((row) => row.clientMsgId === pending.clientMsgId)).toHaveLength(1)
  })

  it('rewrites a failed post in place, with no call', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.forceError({ method: 'chat.postMessage', error: 'restricted_action' })
    valueOf(await sendMessage(engine.registry, eng, 'Refused once', MAIN))
    const failed = rowWith(await rows((list) => rowWith(list, 'Refused once')?.pending === 'failed', 'failed'), 'Refused once')!
    valueOf(await editMessage(engine.registry, refOf(failed), 'Refused, then fixed'))
    await rows((list) => rowWith(list, 'Refused, then fixed')?.pending === 'failed', 'rewritten')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
    expect(actionRows(engine)).toHaveLength(0)
  })

  // A post back in the queue (a 429 here; a lookup that finds it missing ends the same) is not in Slack, so a
  // newer edit goes into the post itself. An edit row queued while it was out must not put the older text back.
  it('keeps the newest text when a post comes back to the queue between two edits', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.gate((method) => method === 'chat.postMessage')
    valueOf(await sendMessage(engine.registry, eng, 'Draft one', MAIN))
    const call = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the post at Slack')
    const pending = rowWith(await rows((list) => rowWith(list, 'Draft one')?.pending === 'sending', 'sending'), 'Draft one')!
    valueOf(await editMessage(engine.registry, refOf(pending), 'Edit while sending'))
    await waitFor(() => (actionRows(engine).length === 1 ? true : undefined), WAIT_MS, 'the edit row waiting on the post')
    engine.fake.decide(call.id, { error: 'ratelimited', status: 429, retryAfter: 2 })
    engine.fake.decide((await waitFor(() => engine.fake.gated().find((c) => c.id === call.id && c.stage === 'answer'), WAIT_MS, 'the 429')).id, 'answer')
    const state = () => readDb(engine, 'user.db', (db) => (db.prepare('SELECT state FROM pending_messages WHERE client_msg_id = ?').get(pending.clientMsgId!) as { state: string } | undefined)?.state)
    await waitFor(() => (state() === 'queued' ? true : undefined), WAIT_MS, 'the post back in the queue')
    valueOf(await editMessage(engine.registry, { channelId: 'C0ENG', ts: `pending:${pending.clientMsgId}`, clientMsgId: pending.clientMsgId! }, 'Edit while queued'))
    engine.fake.gate(undefined)
    await waitFor(() => (state() === undefined && actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the post and its edits settled')
    await quiet(engine)
    expect(engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)?.text).toBe('Edit while queued')
    await rows((list) => rowWith(list, 'Edit while queued')?.pending === undefined && rowWith(list, 'Edit while queued') !== undefined, 'the newest text shown')
  })

  it('refuses to edit someone else’s message', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const list = await rows((list) => list.some((row) => !row.fromMe && row.kind === 'message'), 'a message from someone else')
    const theirs = list.find((row) => !row.fromMe && row.kind === 'message')!
    expect(theirs.editText).toBeUndefined()
    expect(errorOf(await editMessage(engine.registry, refOf(theirs), 'Not mine'))?._tag).toBe('NotFound')
    expect(actionRows(engine)).toHaveLength(0)
  })

  it('sends an edit left pending by a restart', async () => {
    const first = await booted()
    const message = await sent(first, 'Before a restart', watch(first, MAIN))
    first.fake.forceError({ method: 'chat.update', error: 'internal_error', times: 1000 })
    valueOf(await editMessage(first.registry, refOf(message), 'After a restart'))
    await waitFor(() => (apiCalls(first, 'chat.update').length > 0 ? true : undefined), WAIT_MS, 'a try')
    const engine = await restarted(first, (fake) => fake.clearError({ method: 'chat.update' }))
    await watch(engine, MAIN)((list) => rowWith(list, 'After a restart')?.edited === true, 'the edit after the restart')
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    expect(inSlack(engine, message.ts)?.text).toBe('After a restart')
  })

  it('stays idle while the channel’s first edit waits to retry and a second waits behind it', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const first = await sent(engine, 'First draft', rows)
    const second = await sent(engine, 'Second draft', rows)
    engine.fake.forceError({ method: 'chat.update', times: 1000 })
    valueOf(await editMessage(engine.registry, refOf(first), 'First edit'))
    valueOf(await editMessage(engine.registry, refOf(second), 'Second edit'))
    const attempts = () => readDb(engine, 'user.db', (db) => db.prepare(`SELECT max(attempts) AS n FROM outbox WHERE kind = 'edit'`).get() as { n: number })
    // The second failure puts the first row off for two seconds.
    await waitFor(() => (attempts().n >= 2 ? true : undefined), 30_000, 'two tries')
    // The engine shares this thread: a pass that keeps finding the row behind due fills the event loop.
    const before = performance.eventLoopUtilization()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(performance.eventLoopUtilization(before).utilization).toBeLessThan(0.5)
    expect(actionRows(engine)).toHaveLength(2)
  })
})

describe('delete', () => {
  it('removes the message at once; the answer and the echo in either order leave it gone', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Wrong channel, sorry', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.delete', before: true })
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    await rows((list) => !list.some((row) => row.ts === message.ts), 'gone at once')
    expect(inSlack(engine, message.ts)).toBeDefined()
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    expect(inSlack(engine, message.ts)).toBeUndefined()
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => !list.some((row) => row.ts === message.ts), 'still gone')
  })

  it('removes a post still being sent once Slack has it, and drops its pending edit', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    valueOf(await sendMessage(engine.registry, eng, 'Never mind', MAIN))
    const pending = rowWith(await rows((list) => rowWith(list, 'Never mind')?.pending === 'sending', 'sending'), 'Never mind')!
    valueOf(await editMessage(engine.registry, refOf(pending), 'Never mind, really'))
    valueOf(await deleteMessage(engine.registry, refOf(pending)))
    await rows((list) => !list.some((row) => row.clientMsgId === pending.clientMsgId), 'gone at once')
    expect(actionRows(engine)).toEqual([{ kind: 'delete' }])
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the delete sent')
    expect(engine.fake.messages('C0ENG').some((m) => m.client_msg_id === pending.clientMsgId)).toBe(false)
    expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
    await quiet(engine)
    await rows((list) => !list.some((row) => row.clientMsgId === pending.clientMsgId), 'still gone')
  })

  it('treats a message already deleted elsewhere as deleted', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Deleted twice', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => !list.some((row) => row.ts === message.ts), 'gone')
  })
})


// Found by the conformance replay (test/conformance). `outbox` ids were SQLite rowids, which are reused:
// a delete that replaced an edit whose call was out took the edit's id, and the edit's answer
// (`actionDone`, which reads the row by id) ended the delete as if it were the edit. Ids are now never reused.
describe('actions: a delete while an edit is out', () => {
  it('deletes the message once the edit has answered', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    const message = await sent(engine, 'Edit, then delete', rows)
    engine.fake.gate((method) => method === 'chat.update')
    valueOf(await editMessage(engine.registry, refOf(message), 'Edited once'))
    const edit = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the edit at Slack')
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    engine.fake.decide(edit.id, 'run')
    await waitFor(() => engine.fake.gated().find((call) => call.id === edit.id && call.stage === 'answer'), WAIT_MS, 'the edit run')
    engine.fake.gate(undefined)
    await waitFor(() => (readDb(engine, 'user.db', (db) => (db.prepare('SELECT count(*) AS n FROM outbox').get() as { n: number }).n) === 0 ? true : undefined), WAIT_MS, 'the outbox empty')
    expect(engine.fake.messages('C0ENG').some((m) => m.ts === message.ts)).toBe(false)
  })
})
