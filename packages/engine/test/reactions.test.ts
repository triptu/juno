// Reactions through the outbox (M6b; architecture 5.7, specs/outbox.qnt),
// against a fake as strict as Slack about names (`invalid_name`) and
// repeats (`already_reacted`, `no_reaction`): the chip changes at once, the
// call names the emoji as Slack does, a refusal puts back what Slack has
// with Retry and Dismiss, and a reaction that waits long says so.
import { describe, expect, it } from 'vitest'
import { editMessage, openTopic, reactToMessage, sendMessage } from '@juno/state'
import { sleep, waitFor, WAIT_MS } from './harness'
import { apiCalls, quiet, readDb, valueOf } from './scenario'
import { actionRows, booted, chip, eng, inSlack, MAIN, refOf, rowWith, sent, stopEnginesAfterEach, watch } from './actionScenario'

stopEnginesAfterEach()

describe('reactions: showing and toggling', () => {
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

})

describe('reactions: adding and removing', () => {
  it('adds 👍 with the name Slack uses, and removes it', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Thumbs', rows)
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', true))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'added')
    expect(apiCalls(engine, 'reactions.add').map((call) => [call.args['channel'], call.args['timestamp'], call.args['name']])).toEqual([['C0ENG', message.ts, '+1']])
    expect(inSlack(engine, message.ts)?.reactions).toEqual([expect.objectContaining({ name: '+1', count: 1 })])
    await rows((list) => chip(rowWith(list, 'Thumbs'), '+1')?.me === true, 'shown')
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', false))
    await waitFor(() => (actionRows(engine).length === 0 && inSlack(engine, message.ts)?.reactions === undefined ? true : undefined), WAIT_MS, 'removed in Slack')
    await rows((list) => chip(rowWith(list, 'Thumbs'), '+1') === undefined, 'gone')
  })

  it('adds a skin tone and a custom emoji by their Slack names', async () => {
    const engine = await booted()
    engine.fake.addEmoji({ name: 'shipit', url: 'https://example.invalid/shipit.png' })
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Tones and customs', rows)
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1::skin-tone-2', true))
    valueOf(await reactToMessage(engine.registry, refOf(message), 'shipit', true))
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'both sent')
    expect(inSlack(engine, message.ts)?.reactions?.map((r) => r.name)).toEqual(['+1::skin-tone-2', 'shipit'])
    const shown = await rows((list) => chip(rowWith(list, 'Tones and customs'), 'shipit')?.me === true, 'both shown')
    expect(chip(rowWith(shown, 'Tones and customs'), '+1::skin-tone-2')?.me).toBe(true)
    expect(rowWith(shown, 'Tones and customs')?.reactionIssue).toBeUndefined()
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

describe('reactions: refused or waiting', () => {
  it('rolls a refused reaction back with Retry, which sends it again, and Dismiss', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Not yet an emoji', rows)
    valueOf(await reactToMessage(engine.registry, refOf(message), 'shipit', true))
    // Slack refuses a name it does not know: the chip goes, the message says so.
    const refused = await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue?.state === 'failed', 'refused')
    expect(chip(rowWith(refused, 'Not yet an emoji'), 'shipit')).toBeUndefined()
    expect(rowWith(refused, 'Not yet an emoji')?.reactionIssue).toEqual({ name: 'shipit', on: true, state: 'failed' })
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(1)
    // It is not sent again on its own.
    await sleep(1500)
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(1)
    // Retry, once the workspace has the emoji.
    engine.fake.addEmoji({ name: 'shipit', url: 'https://example.invalid/shipit.png' })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'shipit', true))
    await rows((list) => chip(rowWith(list, 'Not yet an emoji'), 'shipit')?.me === true && rowWith(list, 'Not yet an emoji')?.reactionIssue === undefined, 'retried')
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'sent')
    expect(inSlack(engine, message.ts)?.reactions?.map((r) => r.name)).toEqual(['shipit'])
    // A second refusal, dismissed: nothing is sent and the line goes.
    valueOf(await reactToMessage(engine.registry, refOf(message), 'thumbs_up', true))
    await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue?.name === 'thumbs_up', 'refused again')
    valueOf(await reactToMessage(engine.registry, refOf(message), 'thumbs_up', false))
    await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue === undefined, 'dismissed')
    expect(actionRows(engine)).toHaveLength(0)
    expect(apiCalls(engine, 'reactions.remove')).toHaveLength(0)
  })

  it('does not count a reaction on a message Slack no longer has as made', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    const message = await sent(engine, 'Gone elsewhere', rows)
    // Deleted on another device; Juno has not heard yet.
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
    const refused = await rows((list) => rowWith(list, 'Gone elsewhere')?.reactionIssue?.state === 'failed', 'refused')
    expect(chip(rowWith(refused, 'Gone elsewhere'), 'eyes')).toBeUndefined()
    expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM reactions WHERE ts = ?').get(message.ts) as { n: number }).n).toBe(0)
    engine.fake.releaseFrames()
  })

  it('says a reaction is not sent yet when it waits too long', async () => {
    const engine = await booted({ actionStallMillis: 1000 })
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    // The reaction waits for its post, which Slack holds.
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    valueOf(await sendMessage(engine.registry, eng, 'Slow post', MAIN))
    const pending = rowWith(await rows((list) => rowWith(list, 'Slow post')?.pending === 'sending', 'sending'), 'Slow post')!
    valueOf(await reactToMessage(engine.registry, refOf(pending), 'eyes', true))
    const waiting = await rows((list) => rowWith(list, 'Slow post')?.reactionIssue?.state === 'waiting', 'not sent yet')
    expect(chip(rowWith(waiting, 'Slow post'), 'eyes')?.me).toBe(true)
    engine.fake.release()
    await rows((list) => rowWith(list, 'Slow post')?.reactionIssue === undefined && chip(rowWith(list, 'Slow post'), 'eyes')?.count === 1, 'sent')
    expect(actionRows(engine)).toHaveLength(0)
  })
})

describe('reactions from pages', () => {
  it('stores the reactions of a thread reply discovery found by search, when the thread opens', async () => {
    const engine = await booted()
    await quiet(engine)
    const reply = engine.fake.messages('C0ENG').find((m) => m.text?.startsWith('We keep the old primary warm'))!
    const stored = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT name, count, me FROM reactions WHERE channel = ? AND ts = ?').all('C0ENG', reply.ts))
    const row = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT partial, blocks_json IS NOT NULL AS blocks FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', reply.ts))
    // The followed thread's view carries only its latest replies; the discovery search stored this one without its 👍.
    expect(row()).toEqual({ partial: 1, blocks: 0 })
    expect(stored()).toEqual([])
    // Opening the thread does not count the search match as stored: its replies page brings the reply in full.
    valueOf(await openTopic(engine.registry, `t:C0ENG:${reply.thread_ts}`))
    expect(stored()).toEqual([{ name: '+1', count: 2, me: 1 }])
    expect(row()).toEqual({ partial: 0, blocks: 1 })
  })
})
