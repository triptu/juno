// Reactions through the outbox (M6b; architecture 5.7, specs/outbox.qnt), against a fake as strict as Slack
// about names (`invalid_name`) and repeats (`already_reacted`, `no_reaction`): the chip changes at once, the
// call names the emoji as Slack does, quick toggles cost at most two calls, a refusal puts back what Slack has
// with Retry and Dismiss, and a reaction that waits long says so. Every test starts warm on the synced
// default workspace.
import { expect, it } from 'bun:test'
import { editMessage, reactToMessage } from '@juno/state'
import { waitFor, WAIT_MS } from '../harness'
import { actionRows, actionsEnded, chip, fresh, inSlack, outboxScenario, refOf, rowWith, sending, sent } from '../outboxScenario'
import { apiCalls, quiet, valueOf } from '../scenario'
import { step } from '../step'

const { booted, opened } = outboxScenario()

it('shows a reaction at once and sends the fewest calls, by the names Slack uses', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('counts the user’s reaction with another user’s that lands meanwhile', async () => {
    const message = await sent(engine, 'Ready for review', rows)
    engine.fake.holdNext({ method: 'reactions.add', before: true })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
    await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.me === true, 'mine shown')
    engine.fake.addReaction({ channel: 'C0ENG', ts: message.ts, name: 'eyes', user: 'U0MAYA' })
    await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.count === 2, 'both counted')
    engine.fake.release()
    await actionsEnded(engine)
    await quiet(engine)
    const after = await rows((list) => chip(rowWith(list, 'Ready for review'), 'eyes')?.count === 2, 'still two')
    expect(chip(rowWith(after, 'Ready for review'), 'eyes')?.me).toBe(true)
    expect(inSlack(engine, message.ts)?.reactions?.find((r) => r.name === 'eyes')?.count).toBe(2)
  })

  await step('makes at most two calls for quick toggles while an add is out', async () => {
    await fresh(engine)
    const message = await sent(engine, 'Toggle me', rows)
    engine.fake.holdNext({ method: 'reactions.add', before: true })
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', true))
    await waitFor(() => (engine.fake.heldCount({ method: 'reactions.add' }) === 1 ? true : undefined), WAIT_MS, 'the add out')
    // While the add is out: off, on, off. The row keeps the last intent.
    for (const on of [false, true, false]) valueOf(await reactToMessage(engine.registry, refOf(message), '+1', on))
    await rows((list) => chip(rowWith(list, 'Toggle me'), '+1') === undefined, 'shown off')
    engine.fake.release()
    await actionsEnded(engine)
    await quiet(engine)
    expect(apiCalls(engine, 'reactions.add').length + apiCalls(engine, 'reactions.remove').length).toBe(2)
    expect(inSlack(engine, message.ts)?.reactions).toBeUndefined()
    await rows((list) => chip(rowWith(list, 'Toggle me'), '+1') === undefined, 'still off')
  })

  await step('makes no call for an add taken back before it is sent', async () => {
    await fresh(engine)
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
    await actionsEnded(engine)
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(0)
    expect(apiCalls(engine, 'reactions.remove')).toHaveLength(0)
  })

  await step('adds 👍, a skin tone and a custom emoji by their Slack names, and removes 👍', async () => {
    await fresh(engine)
    engine.fake.addEmoji({ name: 'shipit', url: 'https://example.invalid/shipit.png' })
    const message = await sent(engine, 'Tones and customs', rows)
    for (const name of ['+1', '+1::skin-tone-2', 'shipit']) valueOf(await reactToMessage(engine.registry, refOf(message), name, true))
    await actionsEnded(engine, 'all three sent')
    expect(apiCalls(engine, 'reactions.add').map((call) => [call.args['channel'], call.args['timestamp'], call.args['name']])).toEqual([
      ['C0ENG', message.ts, '+1'], ['C0ENG', message.ts, '+1::skin-tone-2'], ['C0ENG', message.ts, 'shipit'],
    ])
    const shown = await rows((list) => ['+1', '+1::skin-tone-2', 'shipit'].every((name) => chip(rowWith(list, 'Tones and customs'), name)?.me === true), 'all three shown')
    expect(rowWith(shown, 'Tones and customs')?.reactionIssue).toBeUndefined()
    valueOf(await reactToMessage(engine.registry, refOf(message), '+1', false))
    await waitFor(() => (actionRows(engine).length === 0 && !inSlack(engine, message.ts)?.reactions?.some((r) => r.name === '+1') ? true : undefined), WAIT_MS, '👍 removed in Slack')
    await rows((list) => chip(rowWith(list, 'Tones and customs'), '+1') === undefined, '👍 gone')
  })

  await step('removes the user’s reaction from a chip others share, which stays', async () => {
    const message = await sent(engine, 'Shared chip', rows)
    engine.fake.addReaction({ channel: 'C0ENG', ts: message.ts, name: 'white_check_mark', user: 'U0MAYA' })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'white_check_mark', true))
    await actionsEnded(engine)
    await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 2, 'two')
    engine.fake.holdFrames({ types: ['reaction_removed'] })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'white_check_mark', false))
    const shown = await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 1, 'one, at once')
    expect(chip(rowWith(shown, 'Shared chip'), 'white_check_mark')?.me).toBe(false)
    await actionsEnded(engine)
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows((list) => chip(rowWith(list, 'Shared chip'), 'white_check_mark')?.count === 1, 'still one')
  })
})

it('rolls a refused reaction back with Retry and Dismiss, and never counts one on a message Slack no longer has', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('rolls a refused reaction back; Retry sends it again and Dismiss sends nothing', async () => {
    const message = await sent(engine, 'Not yet an emoji', rows)
    valueOf(await reactToMessage(engine.registry, refOf(message), 'shipit', true))
    // Slack refuses a name it does not know: the chip goes, the message says so.
    const refused = await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue?.state === 'failed', 'refused')
    expect(chip(rowWith(refused, 'Not yet an emoji'), 'shipit')).toBeUndefined()
    expect(rowWith(refused, 'Not yet an emoji')?.reactionIssue).toMatchObject({ name: 'shipit', on: true, state: 'failed' })
    // It is not sent again on its own.
    await engine.workPass('action')
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(1)
    // Retry, once the workspace has the emoji.
    engine.fake.addEmoji({ name: 'shipit', url: 'https://example.invalid/shipit.png' })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'shipit', true))
    await rows((list) => chip(rowWith(list, 'Not yet an emoji'), 'shipit')?.me === true && rowWith(list, 'Not yet an emoji')?.reactionIssue === undefined, 'retried')
    await actionsEnded(engine)
    expect(inSlack(engine, message.ts)?.reactions?.map((r) => r.name)).toEqual(['shipit'])
    // A second refusal, dismissed: nothing is sent and the line goes.
    valueOf(await reactToMessage(engine.registry, refOf(message), 'thumbs_up', true))
    await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue?.name === 'thumbs_up', 'refused again')
    valueOf(await reactToMessage(engine.registry, refOf(message), 'thumbs_up', false))
    await rows((list) => rowWith(list, 'Not yet an emoji')?.reactionIssue === undefined, 'dismissed')
    expect(actionRows(engine)).toHaveLength(0)
    expect(apiCalls(engine, 'reactions.remove')).toHaveLength(0)
  })

  await step('does not count a reaction on a message deleted on another device as made', async () => {
    const message = await sent(engine, 'Gone elsewhere', rows)
    // Deleted on another device; Juno has not heard yet.
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
    const refused = await rows((list) => rowWith(list, 'Gone elsewhere')?.reactionIssue?.state === 'failed', 'refused')
    expect(chip(rowWith(refused, 'Gone elsewhere'), 'eyes')).toBeUndefined()
    engine.fake.releaseFrames()
    await rows((list) => rowWith(list, 'Gone elsewhere') === undefined, 'the delete shown')
  })
})

it('says a reaction is not sent yet when it waits too long', async () => {
  const engine = await booted({ timing: { actionStallMillis: 1000 } })
  const rows = await opened(engine)
  // The reaction waits for its post, which Slack holds.
  const pending = await sending(engine, rows, 'Slow post')
  valueOf(await reactToMessage(engine.registry, refOf(pending), 'eyes', true))
  const waiting = await rows((list) => rowWith(list, 'Slow post')?.reactionIssue?.state === 'waiting', 'not sent yet')
  expect(chip(rowWith(waiting, 'Slow post'), 'eyes')?.me).toBe(true)
  engine.fake.release()
  await rows((list) => rowWith(list, 'Slow post')?.reactionIssue === undefined && chip(rowWith(list, 'Slow post'), 'eyes')?.count === 1, 'sent')
  expect(actionRows(engine)).toHaveLength(0)
})

it('expires a reaction made offline, and Retry gives it a fresh window', async () => {
  const engine = await booted({ timing: { actionStallMillis: 100, actionDeadlineMillis: 1000 } })
  const rows = await opened(engine)
  const message = await sent(engine, 'Waited offline', rows)
  engine.fake.goOffline()
  await engine.phase('offline')
  valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
  await rows((list) => rowWith(list, 'Waited offline')?.reactionIssue?.state === 'waiting', 'waiting offline')
  await rows((list) => rowWith(list, 'Waited offline')?.reactionIssue?.state === 'failed', 'failed at the deadline')
  expect(apiCalls(engine, 'reactions.add')).toHaveLength(0)
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
  await rows((list) => rowWith(list, 'Waited offline')?.reactionIssue === undefined, 'a fresh window')
  await waitFor(() => (inSlack(engine, message.ts)?.reactions?.some((r) => r.name === 'eyes') ? true : undefined), WAIT_MS, 'the retry sent')
})

it('sends a reaction made offline once the socket is back, and tries a transient failure again', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('a reaction made offline waits, then reaches Slack once the socket is back', async () => {
    const message = await sent(engine, 'Reacted on the train', rows)
    engine.fake.goOffline()
    await engine.phase('offline')
    valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
    const waiting = await rows((list) => rowWith(list, 'Reacted on the train')?.reactionIssue?.state === 'waiting', 'waiting offline')
    expect(chip(rowWith(waiting, 'Reacted on the train'), 'eyes')?.me).toBe(true)
    engine.fake.goOnline()
    await actionsEnded(engine)
    await rows((list) => rowWith(list, 'Reacted on the train')?.reactionIssue === undefined, 'no issue once sent')
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(1)
    expect(inSlack(engine, message.ts)?.reactions?.map((r) => r.name)).toEqual(['eyes'])
  })

  await step('a transient failure is tried again, and the second call sends it', async () => {
    await fresh(engine)
    const message = await sent(engine, 'Flaky network', rows)
    engine.fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 1 })
    valueOf(await reactToMessage(engine.registry, refOf(message), 'tada', true))
    await actionsEnded(engine)
    expect(apiCalls(engine, 'reactions.add')).toHaveLength(2)
    expect(inSlack(engine, message.ts)?.reactions?.map((r) => r.name)).toEqual(['tada'])
    await rows((list) => rowWith(list, 'Flaky network')?.reactionIssue === undefined && chip(rowWith(list, 'Flaky network'), 'tada')?.me === true, 'sent')
  })
})
