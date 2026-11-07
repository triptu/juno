// Sending through the outbox (M6; architecture 5.7, specs/outbox.qnt): the pending row shows at once, and
// the answer, the socket echo, a page and the lookup after a lost answer reconcile it in every order, across
// a drop and a restart, with Slack holding exactly one copy of each message. Cases found by the conformance
// replay (test/conformance) say so. Every test starts warm on the synced default workspace. The network's
// copies of a post and files are in `outbox-copies.flow.test.ts`; edits and deletes in `outbox-actions`.
import { expect, it } from 'bun:test'
import { deleteMessage, discardMessage, draftAtom, retryMessage, saveDraft, sendMessage } from '@juno/state'
import { controlledClock } from '../controlledClock'
import { waitFor, WAIT_MS } from '../harness'
import { copies, eng, fresh, MAIN, outboxScenario, refOf, rowWith, send, settled } from '../outboxScenario'
import { apiCalls, errorOf, quiet, readDb, valueOf } from '../scenario'
import { step } from '../step'

const { booted, watch, opened, restarted, stop } = outboxScenario()

it('reconciles a send once whichever of the answer, the echo or the lookup comes first', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('shows the pending row at once; the answer and then the echo leave one message', async () => {
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    const id = await send(engine, 'Shipping the fix today', rows)
    expect(copies(engine, id)).toBe(0)
    engine.fake.release()
    await rows(settled('Shipping the fix today'), 'the answer stored')
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows(settled('Shipping the fix today'), 'still one row')
    expect(copies(engine, id)).toBe(1)
    expect(apiCalls(engine, 'chat.postMessage').map((call) => call.args['client_msg_id'])).toEqual([id])
  })

  await step('lets the echo reconcile before the answer; the late answer changes nothing', async () => {
    await fresh(engine)
    engine.fake.holdNext({ method: 'chat.postMessage' })
    valueOf(await sendMessage(engine.registry, eng, 'Echo first', MAIN))
    // Slack has run the call and its echo is out; the answer waits.
    const [held] = await waitFor(() => (engine.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? engine.fake.heldCalls({ method: 'chat.postMessage' }) : undefined), WAIT_MS, 'the held answer')
    await rows(settled('Echo first'), 'the echo stored')
    engine.fake.release()
    await quiet(engine)
    await rows(settled('Echo first'), 'still one row')
    expect(copies(engine, String(held!['client_msg_id']))).toBe(1)
  })

  await step('after a lost answer, finds the message in history instead of posting it again', async () => {
    await fresh(engine)
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await send(engine, 'Lost answer', rows)
    await rows(settled('Lost answer'), 'the lookup stored it')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
    expect(apiCalls(engine, 'conversations.history').some((call) => call.args['oldest'] !== undefined)).toBe(true)
    engine.fake.releaseFrames()
    await quiet(engine)
    await rows(settled('Lost answer'), 'still one row')
    expect(copies(engine, id)).toBe(1)
  })

  await step('posts again when the lookup shows Slack never ran the call', async () => {
    await fresh(engine)
    // An internal_error may come after Slack ran the call, so it is unknown, not a refusal.
    engine.fake.forceError({ method: 'chat.postMessage', error: 'internal_error' })
    const id = await send(engine, 'Second try', rows)
    await rows(settled('Second try'), 'posted on the second try')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(2)
    expect(copies(engine, id)).toBe(1)
  })

  await step('posts a channel’s messages in the order they were sent', async () => {
    await fresh(engine)
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    const texts = ['First', 'Second', 'Third']
    for (const text of texts) await send(engine, text, rows)
    engine.fake.release()
    await rows((list) => texts.every((text) => settled(text)(list)), 'all three posted')
    expect(apiCalls(engine, 'chat.postMessage').map((call) => call.args['text'])).toEqual(texts)
  })

  await step('shows a refused send as failed; Retry posts it and Delete draft removes it', async () => {
    engine.fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 2 })
    const kept = await send(engine, 'Try me again', rows)
    const dropped = await send(engine, 'Throw me away', rows)
    await rows((list) => rowWith(list, 'Try me again')?.pending === 'failed' && rowWith(list, 'Throw me away')?.pending === 'failed', 'both failed')
    valueOf(await retryMessage(engine.registry, kept))
    await rows(settled('Try me again'), 'the retry posted it')
    valueOf(await discardMessage(engine.registry, dropped))
    await rows((list) => rowWith(list, 'Throw me away') === undefined, 'the draft deleted')
    expect(copies(engine, kept)).toBe(1)
    expect(copies(engine, dropped)).toBe(0)
    expect(errorOf(await discardMessage(engine.registry, kept))?._tag).toBe('NotFound')
  })

  await step('posts a reply in its thread', async () => {
    await fresh(engine)
    const root = engine.fake.messages('C0ENG').find((m) => (m.reply_count ?? 0) > 0)!
    const topic = `t:C0ENG:${root.ts}`
    const thread = await opened(engine, topic)
    expect(valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Thursday works for me', topic))).toEqual({ topicId: topic })
    await thread(settled('Thursday works for me'), 'the reply posted')
    expect(apiCalls(engine, 'chat.postMessage')[0]!.args['thread_ts']).toBe(root.ts)
  })

  await step('opens a DM with a person never messaged, then posts', async () => {
    await fresh(engine)
    const { topicId } = valueOf(await sendMessage(engine.registry, { kind: 'person', userId: 'U0JONAS' }, 'Welcome aboard'))
    expect(apiCalls(engine, 'conversations.open').map((call) => call.args['users'])).toEqual(['U0JONAS'])
    await watch(engine, topicId)(settled('Welcome aboard'), 'the DM posted')
    expect(apiCalls(engine, 'chat.postMessage')[0]!.args['channel']).toBe(topicId.slice('m:'.length))
  })

  for (const channelId of ['C0ENG', 'G0MAYALEO']) {
    await step(`New chat in ${channelId} queues a thread root and sends its reply once the root is in Slack`, async () => {
      await fresh(engine)
      const target = { kind: 'channel', channelId } as const
      engine.fake.holdNext({ method: 'chat.postMessage', before: true })
      const started = valueOf(await sendMessage(engine.registry, target, `first in ${channelId}`, undefined, undefined, true))
      expect(started.topicId.startsWith(`p:${channelId}:`)).toBe(true)
      const thread = watch(engine, started.topicId)
      const initial = await thread((list) => list.length === 1 && list[0]?.pending === 'sending', 'pending root')
      expect(initial[0]?.root).toBe(true)
      valueOf(await sendMessage(engine.registry, { ...target, threadTs: initial[0]!.ts }, `second in ${channelId}`))
      await thread((list) => list.length === 2, 'pending reply')
      expect(engine.fake.messages(channelId).some((message) => message.text === `second in ${channelId}`)).toBe(false)
      engine.fake.release()
      await thread((list) => list.length === 2 && list.every((row) => row.pending === undefined), 'acknowledged thread')
      const root = engine.fake.messages(channelId).find((message) => message.text === `first in ${channelId}`)!
      expect(engine.fake.messages(channelId).find((message) => message.text === `second in ${channelId}`)?.thread_ts).toBe(root.ts)
      expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(2)
    })
  }
})

it('sends across a lost connection once: from the catch-up page, and a send made offline when the socket is back', async () => {
  const engine = await booted()
  const rows = await opened(engine)

  await step('reconciles from the catch-up page when the answer is lost and the socket drops', async () => {
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await send(engine, 'Across a reconnect', rows)
    await waitFor(() => (copies(engine, id) === 1 ? true : undefined), WAIT_MS, 'Slack has it')
    engine.fake.releaseFrames({ drop: true })
    const reconnected = engine.nextSync()
    engine.fake.dropSocket()
    await reconnected
    await rows(settled('Across a reconnect'), 'reconciled after the reconnect')
    await quiet(engine)
    expect(copies(engine, id)).toBe(1)
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
  })

  await step('keeps a send made offline queued, then posts it once when the socket is back', async () => {
    await fresh(engine)
    engine.main.network.offline = true
    engine.fake.goOffline()
    await engine.phase('offline')
    const id = await send(engine, 'Written on the train', rows)
    // Nothing leaves while offline, so the row never becomes a lookup.
    await engine.workPass('post')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(0)
    expect(rowWith(await rows(() => true, 'the window'), 'Written on the train')?.pending).toBe('sending')
    engine.main.network.offline = false
    engine.fake.goOnline()
    await rows(settled('Written on the train'), 'posted after the reconnect')
    await quiet(engine)
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
    expect(copies(engine, id)).toBe(1)
  })

  // Found by the conformance replay: the worker checked the socket once per pass, so after a post that
  // answered once the socket had dropped, the next queued post went out while Juno was offline.
  await step('waits out a lost connection that comes while another post is out', async () => {
    await fresh(engine)
    engine.fake.gate((method) => method === 'chat.postMessage')
    // Both posts wait for the socket, so the pass after the reconnect takes them both.
    engine.fake.goOffline()
    await engine.phase('offline')
    await send(engine, 'Out when the socket drops', rows)
    valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'C0PRODUCT' }, 'Queued behind it', 'm:C0PRODUCT'))
    engine.fake.goOnline()
    const first = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the first post at Slack')
    // The post goes as soon as the socket is back, before the catch-up ends: wait for it, so `offline` below is the new drop.
    await engine.phase('live', 30_000)
    engine.fake.goOffline()
    await engine.phase('offline')
    engine.fake.decide(first.id, 'run')
    await waitFor(() => engine.fake.gated().find((call) => call.id === first.id && call.stage === 'answer'), WAIT_MS, 'the first post run')
    engine.fake.decide(first.id, 'answer')
    await engine.workPass('post')
    const second = engine.fake.gated().filter((call) => call.id !== first.id)
    engine.fake.gate(undefined)
    // SPEC 8: sends wait out a lost connection.
    expect(second).toHaveLength(0)
  })
})

it('keeps a draft and a post whose answer a restart cut off, and never posts it twice', async () => {
  const first = await booted()
  valueOf(await saveDraft(first.registry, 'm:C0PRODUCT', 'Half a thought'))
  const rows = await opened(first)
  first.fake.holdFrames({ types: ['message'] })
  first.fake.holdNext({ method: 'chat.postMessage' })
  const id = await send(first, 'Before the restart', rows)
  await waitFor(() => (first.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? true : undefined), WAIT_MS, 'the held answer')
  const engine = await restarted(first, (fake) => {
    fake.releaseFrames({ drop: true })
    fake.release()
  })

  await step('looks the post up after the restart; the answer went to the stopped engine', async () => {
    await watch(engine, MAIN)(settled('Before the restart'), 'stored after the restart')
    await quiet(engine)
    expect(copies(engine, id)).toBe(1)
  })

  await step('brings the draft back, and sending clears it', async () => {
    const atom = draftAtom('m:C0PRODUCT')
    const unmount = engine.registry.mount(atom)
    const draft = () => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' ? result.value.text : undefined
    }
    try {
      await waitFor(() => (draft() === 'Half a thought' ? true : undefined), WAIT_MS, 'the draft back')
      valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'C0PRODUCT' }, 'Half a thought, finished', 'm:C0PRODUCT'))
      await waitFor(() => (draft() === '' ? true : undefined), WAIT_MS, 'the draft cleared')
    } finally {
      unmount()
    }
  })
})

// A thread started from Home whose root Slack refuses, with a reply waiting on it: Delete draft on the root
// takes the reply and the thread with it, since the thread never existed. Before, the reply stayed queued
// forever: it could never be claimed without a root, never failed, and showed as sending in the thread.
it('removes the replies and the thread of a started root the user deletes', async () => {
  const engine = await booted()
  engine.fake.forceError({ method: 'chat.postMessage', error: 'restricted_action' })
  const started = valueOf(await sendMessage(engine.registry, eng, 'Root Slack refuses', undefined, undefined, true))
  const thread = watch(engine, started.topicId)
  const root = (await thread((list) => list[0]?.pending === 'failed', 'the root refused'))[0]!
  valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Reply to a refused root'))
  await thread((list) => list.length === 2 && rowWith(list, 'Reply to a refused root')?.pending === 'sending', 'the reply waiting on the root')
  valueOf(await discardMessage(engine.registry, root.clientMsgId!))
  const pendingRows = () => readDb(engine, 'user.db', (db) => db.prepare('SELECT client_msg_id FROM pending_messages').all() as Array<{ client_msg_id: string }>)
  await waitFor(() => (pendingRows().length === 0 ? true : undefined), WAIT_MS, 'the reply gone with its root')
  expect(readDb(engine, 'user.db', (db) => db.prepare('SELECT topic_id FROM started_threads WHERE topic_id = ?').get(started.topicId))).toBeUndefined()
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT topic_id FROM topic_index WHERE topic_id = ?').get(started.topicId))).toBeUndefined()
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT thread_ts FROM thread_subs WHERE thread_ts = ?').get(root.ts))).toBeUndefined()
  await quiet(engine)
  expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
})

// The root of a thread started from Home is at Slack when the user deletes it, with a reply waiting on it.
// The delete waits on the root. Slack then does not take the root, so the delete applies to the row, and the
// reply and the thread go with it, as when the root was queued. Before, only the root's row went: the reply
// stayed queued as sending for good, with the thread's topic row and follow.
it('removes the replies and the thread of a started root deleted while its send was out', async () => {
  const engine = await booted()
  const started = readDb(engine, 'user.db', (db) => db.prepare('SELECT topic_id FROM started_threads').all() as Array<{ topic_id: string }>)
  const pendingRows = () => readDb(engine, 'user.db', (db) => db.prepare('SELECT client_msg_id FROM pending_messages').all() as Array<{ client_msg_id: string }>)
  const deletedWhileOut = async (text: string) => {
    engine.fake.gate((method) => method === 'chat.postMessage')
    const topic = valueOf(await sendMessage(engine.registry, eng, text, undefined, undefined, true))
    const thread = watch(engine, topic.topicId)
    const root = (await thread((list) => list[0]?.pending === 'sending', 'the root at Slack'))[0]!
    const call = await waitFor(() => engine.fake.gated().find((c) => c.stage === 'before'), WAIT_MS, 'the root held')
    valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, `Reply to ${text}`))
    await thread((list) => list.length === 2, 'the reply waiting on the root')
    valueOf(await deleteMessage(engine.registry, refOf(root)))
    return { topicId: topic.topicId, root, call }
  }
  const gone = async (topicId: string, rootTs: string, label: string) => {
    await waitFor(() => (pendingRows().length === 0 ? true : undefined), WAIT_MS, label)
    expect(readDb(engine, 'user.db', (db) => db.prepare('SELECT topic_id FROM started_threads').all())).toEqual(started)
    expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT topic_id FROM topic_index WHERE topic_id = ?').get(topicId))).toBeUndefined()
    expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT thread_ts FROM thread_subs WHERE thread_ts = ?').get(rootTs))).toBeUndefined()
  }

  await step('a 429 puts the root back in the queue, where the delete applies', async () => {
    const { topicId, root, call } = await deletedWhileOut('Root rate limited')
    engine.fake.decide(call.id, { error: 'ratelimited', status: 429, retryAfter: 0.5 })
    engine.fake.decide((await waitFor(() => engine.fake.gated().find((c) => c.id === call.id && c.stage === 'answer'), WAIT_MS, 'the 429')).id, 'answer')
    engine.fake.gate(undefined)
    await gone(topicId, root.ts, 'the reply gone with its rate-limited root')
    await quiet(engine)
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
  })

  await step('a refusal fails the root, where the delete applies', async () => {
    await fresh(engine)
    const { topicId, root, call } = await deletedWhileOut('Root refused')
    engine.fake.decide(call.id, { error: 'restricted_action' })
    engine.fake.decide((await waitFor(() => engine.fake.gated().find((c) => c.id === call.id && c.stage === 'answer'), WAIT_MS, 'the refusal')).id, 'answer')
    engine.fake.gate(undefined)
    await gone(topicId, root.ts, 'the reply gone with its refused root')
    await quiet(engine)
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
  })
})

// A reply's answer is lost, and the thread's root is deleted before the lookup asks: Slack refuses
// `conversations.replies` for good (`thread_not_found`), so no lookup can ever find the reply. The row ends as
// failed, for Retry or Delete draft, and the channel's later posts go. Before, the lookup was asked again with
// backoff forever, and held every later post to the channel.
it('fails a post whose lookup Slack refuses for good, so later posts to the channel go', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  // A root with no replies yet: deleted, it is gone, not a tombstone.
  const root = engine.fake.messages('C0ENG').find((m) => m.thread_ts === undefined && (m.reply_count ?? 0) === 0 && m.user !== undefined)!
  engine.fake.holdFrames({ types: ['message'] })
  engine.fake.gate((method) => method === 'chat.postMessage')
  valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Reply to a root about to go'))
  const call = await waitFor(() => engine.fake.gated()[0], WAIT_MS, 'the reply at Slack')
  const id = call.args['client_msg_id']!
  // The connection closes before Slack runs it, and the root goes before the lookup asks.
  engine.fake.decide(call.id, 'drop')
  engine.fake.deleteMessage({ channel: 'C0ENG', ts: root.ts })
  engine.fake.gate(undefined)
  const later = await send(engine, 'Behind the refused lookup', rows)
  await rows(settled('Behind the refused lookup'), 'the later post went')
  const reply = readDb(engine, 'user.db', (db) => db.prepare('SELECT state, last_error FROM pending_messages WHERE client_msg_id = ?').get(id) as { state: string; last_error: string | null } | undefined)
  expect(reply).toEqual({ state: 'failed', last_error: 'thread_not_found' })
  expect(apiCalls(engine, 'chat.postMessage').map((c) => c.args['client_msg_id'])).toEqual([id, later])
  engine.fake.releaseFrames({ drop: true })
})

// A lookup Slack refuses for a reason that says nothing about the message (`invalid_cursor` here, or a code Slack
// adds later) is asked again: the post may well be there, and Retry on a failed row would post it a second time.
// Before, every refusal outside the transient ones failed the row.
it('keeps asking after a lookup refused for a reason that does not decide the post', async () => {
  const engine = await booted()
  const rows = await opened(engine)
  // Slack runs the post and the answer is lost; with the echo held, only a lookup can settle the row.
  engine.fake.holdFrames({ types: ['message'] })
  engine.fake.loseResponse({ method: 'chat.postMessage' })
  engine.fake.forceError({ method: 'conversations.history', error: 'invalid_cursor' })
  const id = await send(engine, 'Looked up twice', rows)
  const row = () => readDb(engine, 'user.db', (db) => db.prepare('SELECT state, attempts, last_error FROM pending_messages WHERE client_msg_id = ?').get(id) as { state: string; attempts: number; last_error: string | null } | undefined)
  // The row's next write after the refused lookup: a deferral counts an attempt, a failure changes the state.
  const after = await waitFor(() => {
    const current = row()
    return current !== undefined && (current.state !== 'unknown' || current.attempts >= 2) ? current : undefined
  }, WAIT_MS, 'the lookup settled')
  expect(apiCalls(engine, 'conversations.history')[0]?.args['oldest']).toBeDefined()
  expect(after).toMatchObject({ state: 'unknown' })
  await rows(settled('Looked up twice'), 'the next lookup found it')
  expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
  expect(copies(engine, id)).toBe(1)
  engine.fake.releaseFrames({ drop: true })
})

it('flushes when a catch-up ends: a lookup waiting out its backoff runs at once', async () => {
  const time = await controlledClock()
  const engine = await booted({ clock: time.clock, timing: { socketPingMillis: 86_400_000, socketPongTimeoutMillis: 86_400_000 } })
  try {
    await time.freeze()
    // A reply, so the catch-up's history pages cannot reconcile it: only the lookup can.
    const root = engine.fake.messages('C0ENG').find((m) => (m.reply_count ?? 0) > 0)!
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    // An error the client does not retry itself, so each lookup fails at once and only the outbox backoff waits.
    engine.fake.forceError({ method: 'conversations.replies', error: 'request_timeout', times: 100 })
    valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'After the flush'))
    const id = String((await waitFor(() => apiCalls(engine, 'chat.postMessage')[0], WAIT_MS, 'the post')).args['client_msg_id'])
    // The lookup's next due time is the outbox's own schedule; nothing else shows it.
    const pending = () => readDb(engine, 'user.db', (db) => db.prepare('SELECT next_at FROM pending_messages WHERE client_msg_id = ?').get(id) as { next_at: number } | undefined)
    const nextAfter = (previous: number) => waitFor(() => {
      const at = pending()?.next_at
      return at !== undefined && at > previous ? at : undefined
    }, WAIT_MS, 'the next lookup backoff')
    // Advance each scheduled retry after the failed lookup committed it. No real backoff elapses.
    let due = await nextAfter(time.now())
    while (due - time.now() <= 6_000) {
      await time.advance(due - time.now())
      due = await nextAfter(due)
    }
    engine.fake.clearError({ method: 'conversations.replies' })
    engine.fake.releaseFrames({ drop: true })
    engine.fake.dropSocket()
    await engine.phase('offline')
    await time.advance(500)
    await engine.phase('live', 30_000)
    await waitFor(() => (pending() === undefined ? true : undefined), WAIT_MS, 'settled after the catch-up')
    expect(time.now()).toBeLessThan(due)
    expect(copies(engine, id)).toBe(1)
  } finally {
    await stop(engine)
    await time.close()
  }
})
