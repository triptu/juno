// Edits and deletes through the outbox (M6b; architecture 5.7, specs/outbox.qnt): the change shows at once,
// Slack's answer and the socket event reconcile it in either order, a message still being sent is waited for
// (`depends_on`), a refusal puts back what Slack has, and a failure ends once and is shown for Retry or
// Dismiss. Every test starts warm on the synced default workspace. Reactions are in `outbox-reactions`, apart
// from how they pass an edit's backoff and a lost answer, which are here; broadcasts in `outbox-broadcast`.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { SELF_ID } from '@juno/fake-slack'
import { deleteMessage, editMessage, reactToMessage, resolveMessageAction, sendMessage } from '@juno/state'
import { productionTiming } from '../../src/config'
import { controlledClock } from '../controlledClock'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { actionRows, actionsEnded, chip, eng, fresh, inSlack, MAIN, outboxScenario, refOf, rowWith, sending, sent } from '../outboxScenario'
import { apiCalls, quiet, readDb, valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened, restarted, stop } = outboxScenario()

/** Outbox actions that ended as failures, with their attempts: what the message's action issue is built from. */
const failures = (engine: RunningEngine) => readDb(engine, 'user.db', (db) =>
  db.prepare(`SELECT id, attempts, json_extract(payload_json, '$.failed') AS failed FROM outbox WHERE kind IN ('edit', 'delete', 'react') ORDER BY id`).all() as Array<{ id: number; attempts: number; failed: string | null }>)

it('reconciles an edit once in either echo order and keeps the user’s newest text', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('shows the new text at once; the answer and then the echo leave it as it is', async () => {
    const message = await sent(engine, 'Shipping Tuesday', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(engine.registry, refOf(message), 'Shipping Wednesday'))
    const shown = await rows((list) => rowWith(list, 'Shipping Wednesday')?.edited === true, 'the edit shown')
    expect(rowWith(shown, 'Shipping Tuesday')).toBeUndefined()
    expect(inSlack(engine, message.ts)?.text).toBe('Shipping Tuesday')
    engine.fake.release()
    await actionsEnded(engine)
    expect(inSlack(engine, message.ts)?.text).toBe('Shipping Wednesday')
    engine.fake.releaseFrames()
    await quiet(engine)
    const after = await rows((list) => rowWith(list, 'Shipping Wednesday')?.edited === true, 'still edited')
    expect(after.filter((row) => row.ts === message.ts)).toHaveLength(1)
    expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
  })

  await step('keeps the edit when the echo comes before the answer', async () => {
    const message = await sent(engine, 'Lunch at noon', rows)
    engine.fake.holdNext({ method: 'chat.update' })
    valueOf(await editMessage(engine.registry, refOf(message), 'Lunch at one'))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the held answer')
    // Slack has run the call and its echo is out; the row still holds the intent.
    await engine.socketIdle()
    await rows((list) => rowWith(list, 'Lunch at one')?.edited === true, 'shown edited')
    engine.fake.release()
    await actionsEnded(engine)
    await rows((list) => rowWith(list, 'Lunch at one')?.edited === true, 'still edited')
  })

  await step('holds the user’s edit over another client’s edit that lands while it is out', async () => {
    const message = await sent(engine, 'Draft one', rows)
    engine.fake.holdNext({ method: 'chat.update', before: true })
    valueOf(await editMessage(engine.registry, refOf(message), 'Draft three'))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.update' }) === 1 ? true : undefined), WAIT_MS, 'the held call')
    engine.fake.editMessage({ channel: 'C0ENG', ts: message.ts, text: 'Draft two' })
    await engine.socketIdle()
    const during = await rows((list) => rowWith(list, 'Draft three') !== undefined, 'the intent shown')
    expect(rowWith(during, 'Draft two')).toBeUndefined()
    engine.fake.release()
    await actionsEnded(engine)
    await rows((list) => rowWith(list, 'Draft three') !== undefined, 'Slack’s last edit is the user’s')
    expect(inSlack(engine, message.ts)?.text).toBe('Draft three')
  })

  await step('sends again after lost answers, and Slack ends with the text once', async () => {
    const message = await sent(engine, 'Retro at 3', rows)
    engine.fake.loseResponse({ method: 'chat.update', times: 3 })
    valueOf(await editMessage(engine.registry, refOf(message), 'Retro at 4'))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), 30_000, 'the edit ended')
    expect(inSlack(engine, message.ts)?.text).toBe('Retro at 4')
    await rows((list) => rowWith(list, 'Retro at 4')?.edited === true, 'shown edited')
  })

  await step('goes back to Slack’s text when Slack refuses the edit', async () => {
    const message = await sent(engine, 'Too late to change', rows)
    engine.fake.forceError({ method: 'chat.update', error: 'edit_window_closed' })
    valueOf(await editMessage(engine.registry, refOf(message), 'Changed anyway'))
    await actionsEnded(engine)
    const after = await rows((list) => rowWith(list, 'Too late to change') !== undefined, 'the original back')
    expect(rowWith(after, 'Changed anyway')).toBeUndefined()
    expect(rowWith(after, 'Too late to change')?.edited).toBe(false)
  })

  await step('settles chat.update’s partial answer with no echo, for a thread reply with formatted text', async () => {
    await fresh(engine)
    const root = await sent(engine, 'Thread root', rows)
    const topic = `t:C0ENG:${root.ts}`
    const thread = watch(engine, topic)
    valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Reply draft', topic))
    const reply = rowWith(await thread((list) => rowWith(list, 'Reply draft')?.pending === undefined && rowWith(list, 'Reply draft') !== undefined, 'the stored reply'), 'Reply draft')!
    engine.fake.holdFrames({ types: ['message'] })
    valueOf(await editMessage(engine.registry, refOf(reply), 'Reply **changed**'))
    await actionsEnded(engine, 'the partial answer settled')
    await thread((list) => rowWith(list, 'Reply **changed**')?.edited === true, 'the edited reply stays in its thread')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
    expect<unknown>(inSlack(engine, reply.ts)?.thread_ts).toBe(root.ts)
    engine.fake.releaseFrames()
  })

  await step('keeps a code block’s language tag when another line is edited', async () => {
    const posted = engine.fake.workspace.post({
      channel: 'C0ENG',
      user: SELF_ID,
      text: 'Use this:\n```ts\nconst tries = 3\n```',
      blocks: [{ type: 'rich_text', elements: [
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'Use this:' }] },
        { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'ts\nconst tries = 3' }] },
      ] }],
    })
    const message = rowWith(await rows((shown) => rowWith(shown, 'Use this:')?.editText !== undefined, 'the tagged message'), 'Use this:')!
    // The edit field starts with the code as written, tag line and all.
    expect(message.editText).toContain('ts\nconst tries = 3')
    valueOf(await editMessage(engine.registry, refOf(message), message.editText!.replace('Use this:', 'Use this one:')))
    await waitFor(() => (inSlack(engine, posted.ts)?.text?.includes('Use this one:') ? true : undefined), WAIT_MS, 'the edit in Slack')
    // Slack's fallback text breaks lines with \r\n.
    expect(inSlack(engine, posted.ts)?.text?.replace(/\r\n/g, '\n')).toContain('ts\nconst tries = 3')
  })
})

it('waits for a post still being sent before editing, deleting or reacting to it', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('edits a post still being sent by its new ts once Slack has it', async () => {
    const pending = await sending(engine, rows, 'Typo in thsi')
    valueOf(await editMessage(engine.registry, refOf(pending), 'Typo in this'))
    await rows((list) => rowWith(list, 'Typo in this')?.pending === 'sending', 'the edit shown on the pending row')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
    engine.fake.release()
    await actionsEnded(engine, 'the edit sent')
    const posted = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)!
    expect(posted.text).toBe('Typo in this')
    expect(apiCalls(engine, 'chat.update')[0]!.args['ts']).toBe(posted.ts)
    const after = await rows((list) => rowWith(list, 'Typo in this')?.pending === undefined, 'stored')
    expect(after.filter((row) => row.clientMsgId === pending.clientMsgId)).toHaveLength(1)
  })

  await step('reacts to a post still being sent once Slack has it', async () => {
    await fresh(engine)
    const pending = await sending(engine, rows, 'Fresh off the press')
    valueOf(await reactToMessage(engine.registry, refOf(pending), 'rocket', true))
    await rows((list) => chip(rowWith(list, 'Fresh off the press'), 'rocket')?.me === true, 'shown on the pending row')
    engine.fake.release()
    await actionsEnded(engine, 'the reaction sent')
    const posted = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)!
    expect(posted.reactions?.find((r) => r.name === 'rocket')?.users).toEqual([posted.user!])
    expect(apiCalls(engine, 'reactions.add')[0]!.args['timestamp']).toBe(posted.ts)
    await rows((list) => chip(rowWith(list, 'Fresh off the press'), 'rocket')?.count === 1, 'one chip, stored')
  })

  await step('removes a post still being sent once Slack has it, and drops its pending edit', async () => {
    await fresh(engine)
    const pending = await sending(engine, rows, 'Never mind')
    valueOf(await editMessage(engine.registry, refOf(pending), 'Never mind, really'))
    valueOf(await deleteMessage(engine.registry, refOf(pending)))
    await rows((list) => !list.some((row) => row.clientMsgId === pending.clientMsgId), 'gone at once')
    expect(actionRows(engine)).toEqual([{ kind: 'delete' }])
    engine.fake.release()
    await actionsEnded(engine, 'the delete sent')
    expect(engine.fake.messages('C0ENG').some((m) => m.client_msg_id === pending.clientMsgId)).toBe(false)
    expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
    await quiet(engine)
    await rows((list) => !list.some((row) => row.clientMsgId === pending.clientMsgId), 'still gone')
  })

  await step('rewrites a failed post in place, with no call', async () => {
    await fresh(engine)
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
  await step('keeps the newest text when a post comes back to the queue between two edits', async () => {
    await fresh(engine)
    engine.fake.gate((method) => method === 'chat.postMessage')
    valueOf(await sendMessage(engine.registry, eng, 'Queued draft', MAIN))
    const call = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the post at Slack')
    const pending = rowWith(await rows((list) => rowWith(list, 'Queued draft')?.pending === 'sending', 'sending'), 'Queued draft')!
    valueOf(await editMessage(engine.registry, refOf(pending), 'Edit while sending'))
    await waitFor(() => (actionRows(engine).length === 1 ? true : undefined), WAIT_MS, 'the edit waiting on the post')
    engine.fake.decide(call.id, { error: 'ratelimited', status: 429, retryAfter: 2 })
    engine.fake.decide((await waitFor(() => engine.fake.gated().find((c) => c.id === call.id && c.stage === 'answer'), WAIT_MS, 'the 429')).id, 'answer')
    // The outbox's own state is the only sign the post went back to the queue; the row still says sending.
    const state = () => readDb(engine, 'user.db', (db) => (db.prepare('SELECT state FROM pending_messages WHERE client_msg_id = ?').get(pending.clientMsgId!) as { state: string } | undefined)?.state)
    await waitFor(() => (state() === 'queued' ? true : undefined), WAIT_MS, 'the post back in the queue')
    valueOf(await editMessage(engine.registry, { channelId: 'C0ENG', ts: `pending:${pending.clientMsgId}`, clientMsgId: pending.clientMsgId! }, 'Edit while queued'))
    engine.fake.gate(undefined)
    await rows((list) => rowWith(list, 'Edit while queued')?.pending === undefined && rowWith(list, 'Edit while queued') !== undefined, 'the newest text shown')
    await actionsEnded(engine)
    await quiet(engine)
    expect(engine.fake.messages('C0ENG').find((m) => m.client_msg_id === pending.clientMsgId)?.text).toBe('Edit while queued')
  })
})

it('deletes a message at once and reconciles it with Slack in every order', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('removes the message at once; the answer and then the echo leave it gone', async () => {
    const message = await sent(engine, 'Wrong channel, sorry', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.delete', before: true })
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    await rows((list) => !list.some((row) => row.ts === message.ts), 'gone at once')
    expect(inSlack(engine, message.ts)).toBeDefined()
    engine.fake.release()
    await actionsEnded(engine)
    expect(inSlack(engine, message.ts)).toBeUndefined()
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => !list.some((row) => row.ts === message.ts), 'still gone')
  })

  await step('treats a message already deleted elsewhere as deleted', async () => {
    const message = await sent(engine, 'Deleted twice', rows)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    await actionsEnded(engine)
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => !list.some((row) => row.ts === message.ts), 'gone')
  })

  // Found by the conformance replay. Outbox ids were SQLite rowids, which are reused: a delete that replaced an
  // edit whose call was out took the edit's id, and the edit's answer ended the delete. Ids are never reused now.
  await step('deletes the message once an edit that was out has answered', async () => {
    const message = await sent(engine, 'Edit, then delete', rows)
    engine.fake.gate((method) => method === 'chat.update')
    valueOf(await editMessage(engine.registry, refOf(message), 'Edited once'))
    const edit = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the edit at Slack')
    valueOf(await deleteMessage(engine.registry, refOf(message)))
    engine.fake.decide(edit.id, 'run')
    await waitFor(() => engine.fake.gated().find((call) => call.id === edit.id && call.stage === 'answer'), WAIT_MS, 'the edit run')
    engine.fake.gate(undefined)
    await actionsEnded(engine)
    expect(inSlack(engine, message.ts)).toBeUndefined()
  })
})

// Change a persisted row only while the engine is stopped, as a damaged install would leave it.
const persisted = (engine: RunningEngine, change: (db: DatabaseSync) => void) => {
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'))
  try {
    change(db)
  } finally {
    db.close()
  }
}

it('sends an edit left pending by a restart, and ends a broken one once without holding up the next action', async () => {
  const first = await booted()
  const rows = await opened(first)
  const waiting = await sent(first, 'Before a restart', rows)
  const broken = await sent(first, 'Original text', rows)
  first.fake.forceError({ method: 'chat.update', error: 'service_unavailable', times: 1000 })
  valueOf(await editMessage(first.registry, refOf(waiting), 'After a restart'))
  valueOf(await editMessage(first.registry, refOf(broken), 'Saved edit'))
  await waitFor(() => (failures(first)[0]?.attempts === 1 ? true : undefined), WAIT_MS, 'a first try')
  const engine = await restarted(first, (fake) => {
    fake.clearError({ method: 'chat.update' })
    // A payload the engine cannot read: a defect, which no retry can fix.
    persisted(first, (db) => db.exec(`UPDATE outbox SET payload_json = json_set(payload_json, '$.blocksJson', '{broken'), next_at = '0' WHERE id = (SELECT max(id) FROM outbox WHERE kind = 'edit')`))
  })
  const after = watch(engine, MAIN)

  await step('sends the edit that waited', async () => {
    await after((list) => rowWith(list, 'After a restart')?.edited === true, 'the edit after the restart')
    await waitFor(() => (inSlack(engine, waiting.ts)?.text === 'After a restart' ? true : undefined), WAIT_MS, 'the edit in Slack')
  })

  await step('ends the broken edit once, shows it, and sends a later reaction', async () => {
    const failure = await waitFor(() => failures(engine).find((row) => row.failed === 'defect'), WAIT_MS, 'the defect ended')
    await after((list) => rowWith(list, 'Original text')?.actionIssue?.id === failure.id, 'the failure shown')
    valueOf(await reactToMessage(engine.registry, refOf(broken), 'eyes', true))
    await waitFor(() => (inSlack(engine, broken.ts)?.reactions?.some((reaction) => reaction.name === 'eyes') ? true : undefined), WAIT_MS, 'the later reaction sent')
    expect(apiCalls(engine, 'chat.update').filter((call) => call.args['ts'] === broken.ts)).toHaveLength(0)
    valueOf(await resolveMessageAction(engine.registry, failure.id, false))
    await after((list) => rowWith(list, 'Original text')?.actionIssue === undefined, 'dismissed')
  })
})

it('stops a failing edit after five tries for an explicit Retry, and settles one refused because the message is gone', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('stops transient failures after five tries and sends on Retry', async () => {
    const message = await sent(engine, 'Transient original', rows)
    engine.fake.forceError({ method: 'chat.update', error: 'service_unavailable', times: 1000 })
    valueOf(await editMessage(engine.registry, refOf(message), 'Transient edit'))
    const failure = await waitFor(() => failures(engine).find((row) => row.failed !== null), WAIT_MS, 'the retry budget spent')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(5)
    await rows((list) => rowWith(list, 'Transient original')?.actionIssue !== undefined, 'the failure shown')
    engine.fake.clearError({ method: 'chat.update' })
    valueOf(await resolveMessageAction(engine.registry, failure.id, true))
    await actionsEnded(engine, 'the retry settled')
    await rows((list) => rowWith(list, 'Transient edit')?.actionIssue === undefined, 'the edit shown')
  })

  for (const reason of ['deleted', 'left'] as const) {
    await step(`settles an edit refused because the message was ${reason} elsewhere, with no defect`, async () => {
      await fresh(engine)
      const message = await sent(engine, `Before it was ${reason}`, rows)
      engine.fake.holdFrames({ types: ['message', 'channel_left', 'member_left_channel'] })
      if (reason === 'deleted') engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
      else engine.fake.leaveChannel({ channel: 'C0ENG' })
      valueOf(await editMessage(engine.registry, refOf(message), 'After the change'))
      await actionsEnded(engine, 'the refusal settled')
      expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
      engine.fake.releaseFrames()
    })
  }
})

it('sends a reaction while an edit of another message waits out its production backoff [TestClock]', async () => {
  const time = await controlledClock()
  const engine = await booted({ clock: time.clock, timing: { retryBaseMillis: productionTiming.retryBaseMillis, retryCapMillis: productionTiming.retryCapMillis } })
  try {
    const rows = await opened(engine)
    const mine = await sent(engine, 'Edit before reacting', rows)
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
    const target = rowWith(await rows((list) => rowWith(list, 'Reaction delivery target') !== undefined, 'the target'), 'Reaction delivery target')!
    await quiet(engine)
    await time.freeze()
    engine.fake.forceError({ method: 'chat.update', error: 'internal_error', times: 5 })
    valueOf(await editMessage(engine.registry, refOf(mine), 'Edited before reacting'))
    // The refused edit is put off by the outbox's own schedule; nothing else shows it.
    await waitFor(() => (failures(engine).some((row) => row.attempts === 1) ? true : undefined), WAIT_MS, 'the edit waiting out its backoff')
    valueOf(await reactToMessage(engine.registry, refOf(target), 'eyes', true))
    await waitFor(() => (inSlack(engine, target.ts)?.reactions?.some((reaction) => reaction.name === 'eyes') ? true : undefined), WAIT_MS, 'the reaction in Slack')
    // The reaction's outbox row ends, with no issue to show; no time passed, so the edit is still waiting.
    await waitFor(() => (actionRows(engine).map((row) => row.kind).join() === 'edit' ? true : undefined), WAIT_MS, 'only the edit left in the outbox')
    expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
  } finally {
    await stop(engine)
    await time.close()
  }
})

it('a reaction whose answer the network lost and sent again is added once and taken away once', async () => {
  const engine = await booted()
  // Chromium sends a request again when its connection closes with no answer (ADR 0014), so Slack runs it twice.
  engine.main.network.resend = true
  const rows = await opened(engine)
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'React over a lost answer' })
  const target = rowWith(await rows((list) => rowWith(list, 'React over a lost answer') !== undefined, 'the target'), 'React over a lost answer')!
  const reactions = () => inSlack(engine, target.ts)?.reactions ?? []

  await step('the add Slack ran twice ends as made, with one reaction in Slack', async () => {
    engine.fake.loseResponse({ method: 'reactions.add' })
    valueOf(await reactToMessage(engine.registry, refOf(target), '+1', true))
    await actionsEnded(engine, 'the add ended')
    expect(apiCalls(engine, 'reactions.add').map((call) => call.error)).toEqual(['lost', 'already_reacted'])
    expect(reactions()).toMatchObject([{ name: '+1', count: 1 }])
    await rows((list) => chip(rowWith(list, 'React over a lost answer'), '+1')?.count === 1 && rowWith(list, 'React over a lost answer')?.reactionIssue === undefined, 'one chip, yours')
  })

  await step('the remove Slack ran twice ends as made, with no reaction left', async () => {
    engine.fake.loseResponse({ method: 'reactions.remove' })
    valueOf(await reactToMessage(engine.registry, refOf(target), '+1', false))
    await actionsEnded(engine, 'the remove ended')
    expect(apiCalls(engine, 'reactions.remove').map((call) => call.error)).toEqual(['lost', 'no_reaction'])
    expect(reactions()).toEqual([])
    await rows((list) => chip(rowWith(list, 'React over a lost answer'), '+1') === undefined && rowWith(list, 'React over a lost answer')?.reactionIssue === undefined, 'no chip')
  })
})
