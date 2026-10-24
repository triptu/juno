// Following threads (SPEC 5, "Subscribe works on any thread"; specs/follow.qnt), end to end: the user's
// Subscribe and Unsubscribe are mirrored to Slack with undo, a reply or a mention follows as in Slack, and a
// refused or racing command never leaves a follow Slack does not have. `follow-races.flow.test.ts` has the
// follows Juno did not make. Every test starts warm on the synced default workspace.
import { afterEach, expect, it } from 'bun:test'
import type { TopicCounts, UndoCommand } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { topicCountsAtom } from '@juno/state'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, errorOf, quiet, restart, storedFollow, subscribe, threadId as threadIdIn, tsOf, unsubscribe, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = () => syncedEngine(engines)
const threadId = (engine: RunningEngine, channel: string, prefix: string) => threadIdIn(engine.fake, channel, prefix)
/** A followed thread of the fixture, and an active one the user does not follow. */
const followed = (engine: RunningEngine) => threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
const unfollowed = (engine: RunningEngine) => threadId(engine, 'C0PLATFORM', 'We have 142 flags')
const shows = async (engine: RunningEngine, id: string) => (await engine.rows()).some((r) => r.id === id)

/** Replays an undo the way the renderer's undo stack does: the command its tag names. */
const replay = (engine: RunningEngine, undo: UndoCommand) => {
  if (undo._tag === 'topics.subscribe') return subscribe(engine, undo.id)
  if (undo._tag === 'topics.unsubscribe') return unsubscribe(engine, undo.id)
  throw new Error(`not a follow undo: ${undo._tag}`)
}

/** The sidebar's unread dots, once they agree with the rows. */
async function countsMatchRows(engine: RunningEngine): Promise<TopicCounts> {
  const atom = topicCountsAtom()
  const unmount = engine.registry.mount(atom)
  try {
    return await waitFor(async () => {
      const result = engine.registry.get(atom)
      if (result._tag !== 'Success') return undefined
      const rows = await engine.rows()
      const unread = rows.filter((r) => r.unreadCount > 0)
      const dms = unread.filter((r) => r.channel.kind === 'im' || r.channel.kind === 'mpim').length
      return result.value.dmsUnread === dms && result.value.channelsUnread === unread.length - dms ? result.value : undefined
    }, undefined, 'the counts to match the rows')
  } finally {
    unmount()
  }
}

// The user follows and unfollows
it('Subscribe adds a thread live and mirrors it to Slack, Unsubscribe removes it, and undo brings it back', async () => {
  const engine = await synced()
  const id = unfollowed(engine)
  expect(await shows(engine, id)).toBe(false)
  engine.fake.resetCalls()

  await step('Subscribe adds the row and tells Slack with the read pointer', async () => {
    expect(valueOf(await subscribe(engine, id))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the subscribed thread')
    expect(rows.find((r) => r.id === id)).toMatchObject({ kind: 'thread', subscribed: true, channel: { id: 'C0PLATFORM' } })
    const adds = apiCalls(engine, 'subscriptions.thread.add')
    expect(adds.map((call) => [call.args['channel'], call.args['thread_ts']])).toEqual([['C0PLATFORM', tsOf(id)]])
    expect(adds[0]!.args['last_read']).toBeTruthy()
    expect(engine.fake.workspace.subscription('C0PLATFORM', tsOf(id))?.subscribed).toBe(true)
  })

  await step('subscribing again changes nothing, so there is nothing to undo', async () => {
    expect(valueOf(await subscribe(engine, id))).toEqual({})
    expect(apiCalls(engine, 'subscriptions.thread.add')).toHaveLength(1)
  })

  await step('Unsubscribe removes it, and its undo follows again', async () => {
    const result = valueOf(await unsubscribe(engine, id))
    expect(result).toEqual({ undo: { _tag: 'topics.subscribe', id } })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone')
    expect(apiCalls(engine, 'subscriptions.thread.remove').map((c) => c.args)).toMatchObject([{ channel: 'C0PLATFORM', thread_ts: tsOf(id) }])
    expect(engine.fake.workspace.subscription('C0PLATFORM', tsOf(id))?.subscribed).toBe(false)
    expect(valueOf(await replay(engine, result.undo!))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    await engine.rowsUntil((rows) => rows.some((r) => r.id === id && r.subscribed), 'the thread back')
  })

  await step('a Main or an unknown topic has no follow: NotFound, and Slack is not called', async () => {
    const calls = engine.fake.calls.length
    for (const target of ['m:C0ENG', 't:C0ENG:1.000', 'm:C0NOPE']) {
      expect(errorOf(await subscribe(engine, target))).toMatchObject({ _tag: 'NotFound' })
      expect(errorOf(await unsubscribe(engine, target))).toMatchObject({ _tag: 'NotFound' })
    }
    expect(await shows(engine, 'm:C0ENG')).toBe(true)
    expect(apiCalls(engine).slice(calls).filter((call) => call.method.startsWith('subscriptions.'))).toEqual([])
  })
})

it('a reply by the user, or a mention of them, follows the thread as in Slack, and the dots count it', async () => {
  const engine = await synced()
  const before = await countsMatchRows(engine)

  await step('a reply by the user follows the thread, with the reply as preview', async () => {
    const id = threadId(engine, 'C0ENG', 'checkout.spec')
    engine.fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: 'Yes, until Friday.', threadTs: tsOf(id) })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id && r.subscribed), 'the thread the user replied in')
    expect(rows.find((r) => r.id === id)).toMatchObject({ subscribed: true, preview: { sender: 'You', text: 'Yes, until Friday.' } })
  })

  await step('a mention in a thread Slack said nothing about follows it, and the channel dots go up', async () => {
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Who owns the flaky checkout test?' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `<@${SELF_ID}> can you take a look?`, threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id && r.subscribed), 'the mentioned thread followed')
    expect(rows.find((r) => r.id === id)).toMatchObject({ kind: 'thread', mentionsMe: true, section: 'recent' })
    expect(rows.find((r) => r.id === id)!.unreadCount).toBeGreaterThan(0)
    expect((await countsMatchRows(engine)).channelsUnread).toBeGreaterThan(before.channelsUnread)
  })

  await step('a mention after an unfollow made elsewhere follows the thread again', async () => {
    const id = followed(engine)
    engine.fake.workspace.unsubscribe('C0ENG', tsOf(id) as Parameters<typeof engine.fake.workspace.unsubscribe>[1])
    await engine.rowsUntil((list) => !list.some((r) => r.id === id), 'the unfollowed thread gone')
    // The unfollow came from another client: Juno did not call Slack for it.
    expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `<@${SELF_ID}> one more thing on the plan.`, threadTs: tsOf(id) })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id && r.subscribed), 'the thread followed again')
    expect(rows.find((r) => r.id === id)).toMatchObject({ mentionsMe: true, section: 'recent' })
    await countsMatchRows(engine)
  })

  await step('a user group mention counts as a mention', async () => {
    // A self group is read once per session; the next start reads it.
    const next = await restart(engines, engine, (fake) => fake.setSelfUsergroups({ ids: ['S0PLATFORM'] }))
    const id = followed(next)
    next.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Heads up <!subteam^S0PLATFORM|@platform>, review please.', threadTs: tsOf(id) })
    const rows = await next.rowsUntil((list) => list.some((r) => r.id === id && r.preview.text.startsWith('Heads up')), 'the group mention')
    expect(rows.find((r) => r.id === id)).toMatchObject({ mentionsMe: true })
  })
})

it('subscribing to a thread Juno has no read pointer for sends the root as last_read', async () => {
  const engine = await synced()
  const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Who owns the flaky runner?' })
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Platform, I think.', threadTs: root.ts })
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Confirmed.', threadTs: root.ts })
  await engine.socketIdle()
  const id = `t:C0ENG:${root.ts}`
  valueOf(await subscribe(engine, id))
  expect(apiCalls(engine, 'subscriptions.thread.add').at(-1)!.args['last_read']).toBe(root.ts)
  await engine.rowsUntil((list) => list.some((r) => r.id === id && r.unreadCount === 2), 'the thread with both replies unread')
})

// Slack refuses or races a follow command (review M3 finding 10)
it('a rejected Subscribe reverts the local change and returns the typed error; a later Subscribe works', async () => {
  const engine = await synced()
  const id = unfollowed(engine)
  engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })
  expect(errorOf(await subscribe(engine, id))).toMatchObject({ _tag: 'Rejected', code: 'not_allowed' })
  // Slack's silence is stored as silence, so the next subscribe is a change.
  expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBeUndefined()
  expect(engine.fake.workspace.subscription('C0PLATFORM', tsOf(id))?.subscribed).toBe(false)
  engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Lunch?' })
  const rows = await engine.rowsUntil((list) => list[0]?.preview.text === 'Lunch?', 'the list moved on')
  expect(rows.some((r) => r.id === id)).toBe(false)
  expect(valueOf(await subscribe(engine, id))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
  await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the thread after the retry')
})

it('a rejected Unsubscribe asks Slack and keeps the follow Slack still has', async () => {
  const engine = await synced()
  const id = followed(engine)
  engine.fake.forceError({ method: 'subscriptions.thread.remove', error: 'not_allowed' })
  expect(errorOf(await unsubscribe(engine, id))).toMatchObject({ _tag: 'Rejected', code: 'not_allowed' })
  await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'the thread back')
  expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(1)
  expect(apiCalls(engine, 'conversations.replies').some((c) => c.args['ts'] === tsOf(id))).toBe(true)
})

it('a failed Subscribe does not undo a follow Slack made meanwhile', async () => {
  const engine = await synced()
  const id = unfollowed(engine)
  engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })
  engine.fake.holdNext({ method: 'subscriptions.thread.add' })
  const pending = subscribe(engine, id)
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), undefined, 'the held add')
  // Another client follows the thread while Juno's call is failing.
  engine.fake.followThread({ channel: 'C0PLATFORM', threadTs: tsOf(id) })
  await engine.socketIdle()
  engine.fake.release()
  expect(errorOf(await pending)).toMatchObject({ _tag: 'Rejected' })
  await quiet(engine)
  await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'follow restored after rejection')
  expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBe(1)
})

it('commands on one thread run in order: an Unsubscribe waits for a Subscribe whose call then fails', async () => {
  const engine = await synced()
  const id = unfollowed(engine)
  engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })
  engine.fake.holdNext({ method: 'subscriptions.thread.add' })
  const first = subscribe(engine, id)
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), undefined, 'the held add')
  const second = unsubscribe(engine, id)
  await waitFor(() => (engine.pendingCommands(id) === 2 ? true : undefined), undefined, 'both commands admitted on the thread')
  expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
  engine.fake.release()
  expect(errorOf(await first)).toMatchObject({ _tag: 'Rejected' })
  // By its turn the thread is unfollowed again, so there is nothing to change and nothing to undo.
  expect(valueOf(await second)).toEqual({})
  expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
  expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBeUndefined()
})

it('a reply from Slack while a Subscribe is in flight does not hide the intent, and Slack is asked again afterwards', async () => {
  const engine = await synced()
  const id = unfollowed(engine)
  engine.fake.holdNext({ method: 'subscriptions.thread.add' })
  const pending = subscribe(engine, id)
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), undefined, 'the held add')
  // Slack accepted the add (its handler ran and sent thread_subscribed), then another client unfollowed.
  engine.fake.unfollowThread({ channel: 'C0PLATFORM', threadTs: tsOf(id) })
  await waitFor(() => (engine.fake.frames.some((f) => f.type === 'thread_unsubscribed') ? true : undefined), undefined, 'the unfollow event')
  await engine.socketIdle()
  // The command is still pending, so its intent stays visible.
  expect(await shows(engine, id)).toBe(true)
  engine.fake.release()
  expect(valueOf(await pending)).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
  // The noted observation made the command ask for the root: Slack's newer unfollow wins.
  await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone after the refresh')
  expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBe(0)
})
