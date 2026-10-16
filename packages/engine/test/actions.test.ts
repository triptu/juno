// Edits, deletes and reactions through the outbox (M6b; architecture 5.7,
// specs/outbox.qnt): the change shows at once, Slack's answer and the socket
// event reconcile it in either order, a message still being sent is waited
// for (`depends_on`), and a refusal puts back what Slack has.
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageRef, MessageView } from '@juno/contract'
import { deleteMessage, editMessage, messagesAtom, reactToMessage, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, errorOf, quiet, readDb, restart, valueOf } from './scenario'

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

type Rows = ReadonlyArray<MessageView>

/** The topic's message window, mounted, read until `predicate` holds. */
function watch(engine: RunningEngine, topicId: string) {
  const atom = messagesAtom(topicId)
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<MessageView> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  return (predicate: (rows: Rows) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      const rows = window?.order.map((id) => window.rows.get(id)!)
      return rows !== undefined && predicate(rows) ? rows : undefined
    }, WAIT_MS, label)
}

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

const rowWith = (rows: Rows, text: string) => rows.find((row) => textOf(row) === text)
const refOf = (row: MessageView): MessageRef => ({ channelId: 'C0ENG', ts: row.ts, ...(row.clientMsgId === undefined ? {} : { clientMsgId: row.clientMsgId }) })

/** Sends `text` to #eng's Main and waits until Slack's message is stored. */
async function sent(engine: RunningEngine, text: string, rows: ReturnType<typeof watch>): Promise<MessageView> {
  valueOf(await sendMessage(engine.registry, eng, text, MAIN))
  const list = await rows((list) => rowWith(list, text)?.pending === undefined && rowWith(list, text) !== undefined, `"${text}" stored`)
  return rowWith(list, text)!
}

const inSlack = (engine: RunningEngine, ts: string) => engine.fake.messages('C0ENG').find((m) => m.ts === ts)
const actionRows = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare(`SELECT kind FROM outbox WHERE kind IN ('edit', 'delete', 'react')`).all() as Array<{ kind: string }>)
const chip = (row: MessageView | undefined, name: string) => row?.reactions.find((reaction) => reaction.name === name)

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
    for (const unmount of unmounts.splice(0)) unmount()
    const engine = await restart(engines, first, (fake) => fake.clearError({ method: 'chat.update' }))
    await watch(engine, MAIN)((list) => rowWith(list, 'After a restart')?.edited === true, 'the edit after the restart')
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    expect(inSlack(engine, message.ts)?.text).toBe('After a restart')
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

describe('reactions', () => {
  it('shows the user’s reaction at once, counted with another user’s that lands meanwhile', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Ready for review', rows)
    engine.fake.holdNext({ method: 'reactions.add', before: true })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
    await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.me === true, 'mine shown')
    engine.fake.addReaction({ channel: 'C0ENG', ts: message.ts, name: 'eyes', user: 'U0MAYA' })
    await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.count === 2, 'both counted')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    await quiet(engine)
    const after = await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.count === 2, 'still two')
    expect(chip(rowWith(after, 'Ready for review'), 'eyes')?.me).toBe(true)
    expect(inSlack(engine, message.ts)?.reactions?.find((r) => r.name === 'eyes')?.count).toBe(2)
  })

  it('cancels an add and a remove made before the worker sends, and makes at most two calls for quick toggles', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Toggle me', rows)
    engine.fake.holdNext({ method: 'reactions.add', before: true })
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', true))
    await waitFor(() => (engine.fake.heldCount({ method: 'reactions.add' }) === 1 ? true : undefined), WAIT_MS, 'the add out')
    // While the add is out: off, on, off. The row keeps the last intent.
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', false))
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', true))
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', false))
    await rows((list) => chip(rowWith(list, 'Toggle me'), '+1') === undefined, 'shown off')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the row ended')
    await quiet(engine)
    expect(apiCalls(engine, 'reactions.add').length + apiCalls(engine, 'reactions.remove').length).toBe(2)
    expect(inSlack(engine, message.ts)?.reactions).toBeUndefined()
    await rows((list) => chip(rowWith(list, 'Toggle me'), '+1') === undefined, 'still off')
  })

  it('makes no call for an add taken back before it is sent', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Second thoughts', rows)
    // An earlier change in the channel holds the reaction back until it settles.
    engine.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(engine.registry, refOf(message), 'Second thoughts, edited'))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the edit out')
    valueOf(await reactToMessage(engine.registry, refOf(message), 'tada', true))
    await rows((list) => chip(rowWith(list, 'Second thoughts, edited'), 'tada')?.me === true, 'shown on')
    valueOf(await reactToMessage(engine.registry, refOf(message), 'tada', false))
    await rows((list) => chip(rowWith(list, 'Second thoughts, edited'), 'tada') === undefined, 'shown off')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the rows ended')
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(0)
    expect(apiCalls(engine, 'reactions.remove')).toHaveLength(0)
  })

  it('removes the user’s reaction from a chip others share, which stays', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Shared chip', rows)
    engine.fake.addReaction({ channel: 'C0ENG', ts: message.ts, name: 'white_check_mark', user: 'U0MAYA' })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'white_check_mark', true))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'added')
    await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 2, 'two')
    engine.fake.holdFrames({ types: ['reaction_removed'] })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'white_check_mark', false))
    const shown = await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 1, 'one, at once')
    expect(chip(rowWith(shown, 'Shared chip'), 'white_check_mark')?.me).toBe(false)
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'removed')
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 1, 'still one')
  })

  it('reacts to a post still being sent once Slack has it', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    valueOf(await sendMessage(engine.registry, eng, 'Fresh off the press', MAIN))
    const pending = rowWith(await rows((list) => rowWith(list, 'Fresh off the press')?.pending === 'sending', 'sending'), 'Fresh off the press')!
    valueOf(await reactToMessage(engine.registry, refOf(pending), 'rocket', true))
    await rows((list) => chip(rowWith(list, 'Fresh off the press'), 'rocket')?.me === true, 'shown on the pending row')
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'the reaction sent')
    const posted = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)!
    expect(posted.reactions?.find((r) => r.name === 'rocket')?.users).toEqual([posted.user])
    expect(apiCalls(engine, 'reactions.add')[0]!.args['timestamp']).toBe(posted.ts)
    await rows((list) => chip(rowWith(list, 'Fresh off the press'), 'rocket')?.count === 1, 'one chip, stored')
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
