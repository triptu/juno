import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareTs, isMessageChanged, isMessageDeleted, millisToTs } from '@juno/slack-schema'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { isType, TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeEach(async () => {
  fake = await startFakeSlack({ now: Date.UTC(2026, 9, 12, 9, 0, 0) })
  client = new TestClient(fake)
})

afterEach(async () => {
  await fake.close()
})

describe('control API', () => {
  it('forceError answers the next call of a method with ok: false before the handler runs, then recovers', async () => {
    fake.forceError({ method: 'subscriptions.thread.add', error: 'internal_error' })
    const root = fake.messages('C0ENG').find((m) => m.text?.startsWith('checkout.spec'))!
    const socket = await client.connect()
    const first = await client.call('subscriptions.thread.add', { channel: 'C0ENG', thread_ts: root.ts })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ ok: false, error: 'internal_error' })
    // The handler never ran: no subscription changed and no event was sent.
    expect(fake.workspace.subscription('C0ENG', root.ts)?.subscribed).toBe(false)
    const second = await client.call('subscriptions.thread.add', { channel: 'C0ENG', thread_ts: root.ts })
    expect(second.body.ok).toBe(true)
    await socket.next(isType('thread_subscribed'))
    expect(socket.frames.some((f) => f.type === 'thread_subscribed')).toBe(false)
    socket.close()
  })

  it('holds an edge user response until release', async () => {
    fake.holdNext({ method: 'edge:users/info' })
    const response = client.edge('users/info', { ids: ['U0MAYA'] })
    await expect.poll(() => fake.heldCount({ method: 'edge:users/info' })).toBe(1)
    fake.release({ method: 'edge:users/info' })
    expect(await response).toMatchObject({ ok: true, results: [{ id: 'U0MAYA' }] })
    expect(fake.heldCount()).toBe(0)
  })

  it('holdNext runs the handler but answers only on release, so events can land while a page is in flight', async () => {
    fake.holdNext({ method: 'conversations.history' })
    const held = client.ok('conversations.history', { channel: 'C0ENG', limit: 5 })
    let answered = false
    void held.then(() => (answered = true))
    for (let waited = 0; fake.heldCount({ method: 'conversations.history' }) === 0 && waited < 5_000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(fake.heldCount({ method: 'conversations.history' })).toBe(1)
    expect(fake.heldCalls({ method: 'conversations.history' })[0]).toMatchObject({ channel: 'C0ENG' })
    expect(answered).toBe(false)
    // A different method is not held.
    expect((await client.ok('client.counts', {})).channels.length).toBeGreaterThan(0)
    fake.release({ method: 'conversations.history' })
    const page = await held
    expect(page.messages).toHaveLength(5)
    expect(fake.heldCount()).toBe(0)
    // The rule was for one call only.
    expect((await client.ok('conversations.history', { channel: 'C0ENG', limit: 1 })).messages).toHaveLength(1)
  })

  it('an incremental client.counts lists only the conversations that changed since counts_last_fetched', async () => {
    const full = await client.ok('client.counts', { thread_counts_by_channel: true })
    expect(full.channels.length).toBeGreaterThan(3)
    const fetched = full.counts_last_fetched!
    fake.advanceClock({ millis: 5_000 })
    const quiet = await client.ok('client.counts', { thread_counts_by_channel: true, counts_last_fetched: fetched + 1 })
    expect([...quiet.channels, ...quiet.ims, ...quiet.mpims]).toHaveLength(0)
    fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'hello' })
    fake.markRead({ channel: 'D0MAYA', ts: fake.messages('D0MAYA').at(-1)!.ts })
    fake.joinChannel({ channel: 'C0SALES' })
    const changed = await client.ok('client.counts', { thread_counts_by_channel: true, counts_last_fetched: fetched + 1 })
    expect(changed.channels.map((c) => c.id).toSorted()).toEqual(['C0ENG', 'C0SALES'])
    expect(changed.ims.map((c) => c.id)).toEqual(['D0MAYA'])
  })

  it('a reply by self follows the thread and Slack says so with thread_subscribed', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const root = fake.messages('C0ENG').find((m) => m.text?.startsWith('checkout.spec'))!
    expect(fake.workspace.subscription('C0ENG', root.ts)?.subscribed).toBe(false)
    fake.injectMessage({ channel: 'C0ENG', user: fake.selfId, text: 'Yes, until Friday.', threadTs: root.ts })
    const subscribed = await socket.next(isType('thread_subscribed'))
    expect(subscribed.subscription.thread_ts).toBe(root.ts)
    expect(fake.workspace.subscription('C0ENG', root.ts)?.subscribed).toBe(true)
    // A second reply in a thread already followed sends no second event.
    fake.injectMessage({ channel: 'C0ENG', user: fake.selfId, text: 'Ping.', threadTs: root.ts })
    await socket.next((f) => f.type === 'message' && 'text' in f && f.text === 'Ping.')
    expect(socket.frames.some((f) => f.type === 'thread_subscribed')).toBe(false)
    socket.close()
  })

  it('renameChannel emits the partial channel object Slack sends, and conversations.info answers with the full one', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    fake.renameChannel({ channel: 'C0HIRING', name: 'recruiting' })
    const renamed = await socket.next(isType('group_rename'))
    expect(renamed.channel).toEqual({ id: 'C0HIRING', name: 'recruiting', name_normalized: 'recruiting', created: expect.any(Number) })
    const info = await client.ok('conversations.info', { channel: 'C0HIRING' })
    expect(info.channel).toMatchObject({ id: 'C0HIRING', name: 'recruiting', is_private: true, is_member: true })
    const missing = await client.call('conversations.info', { channel: 'C0NOPE' })
    expect(missing.body).toEqual({ ok: false, error: 'channel_not_found' })
    socket.close()
  })

  it('force429 answers the next calls of a method with 429 and Retry-After, then recovers', async () => {
    fake.force429({ method: 'conversations.history', retryAfter: 7, times: 2 })
    const first = await client.call('conversations.history', { channel: 'C0ENG' })
    expect(first.status).toBe(429)
    expect(first.retryAfter).toBe('7')
    expect(first.body).toEqual({ ok: false, error: 'ratelimited' })
    const other = await client.call('client.counts', {})
    expect(other.status).toBe(200)
    const second = await client.call('conversations.history', { channel: 'C0ENG' })
    expect(second.status).toBe(429)
    const third = await client.call('conversations.history', { channel: 'C0ENG' })
    expect(third.status).toBe(200)
    expect(third.body.ok).toBe(true)
  })

  it('records every call so tests can assert budgets', async () => {
    await client.ok('client.userBoot', {})
    await client.ok('client.counts', { thread_counts_by_channel: true })
    await client.ok('conversations.history', { channel: 'C0ENG', limit: 5 })
    await client.call('conversations.history', { channel: 'C0NOPE' })
    expect(fake.callCount()).toBe(4)
    expect(fake.callCount('conversations.history')).toBe(2)
    const failed = fake.calls.find((c) => c.error !== undefined)
    expect(failed?.error).toBe('channel_not_found')
    expect(fake.calls[2]?.args).toEqual({ token: 'xoxc-redacted', channel: 'C0ENG', limit: '5' })
    fake.resetCalls()
    expect(fake.callCount()).toBe(0)
  })

  it('expireSession makes the API refuse the session and tells the socket', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    fake.expireSession()
    await socket.next(isType('user_session_expiration'))
    expect((await socket.closed).code).toBe(1006)
    const call = await client.call('client.counts', {})
    expect(call.body).toEqual({ ok: false, error: 'invalid_auth' })
    const fresh = new TestClient(fake, fake.signIn())
    expect((await fresh.call('client.counts', {})).body.ok).toBe(true)
  })

  it('dropSocket terminates the connection without a close frame', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    expect(fake.socketCount()).toBe(1)
    fake.dropSocket()
    expect((await socket.closed).code).toBe(1006)
    expect(fake.socketCount()).toBe(0)
    const again = await client.connect()
    await again.next(isType('hello'))
    again.close()
  })

  it('advanceClock moves the time new messages get', async () => {
    const start = fake.now()
    expect(fake.advanceClock({ millis: 3_600_000 })).toBe(start + 3_600_000)
    const posted = await client.ok('chat.postMessage', { channel: 'C0ENG', text: 'later', client_msg_id: 'c' })
    expect(compareTs(posted.ts, millisToTs(start + 3_600_000))).toBeGreaterThanOrEqual(0)
    expect(compareTs(posted.ts, millisToTs(start + 3_600_001))).toBe(-1)
  })

  it('markRead from another client emits the marked event and changes counts', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const before = await client.ok('client.counts', {})
    expect(before.channels.find((c) => c.id === 'C0ALERTSPROD')?.has_unreads).toBe(true)
    const latest = before.channels.find((c) => c.id === 'C0ALERTSPROD')!.latest!
    fake.markRead({ channel: 'C0ALERTSPROD', ts: latest })
    const marked = await socket.next(isType('channel_marked'))
    expect(marked.channel).toBe('C0ALERTSPROD')
    expect(marked.ts).toBe(latest)
    expect(marked.unread_count).toBe(0)
    const after = await client.ok('client.counts', {})
    expect(after.channels.find((c) => c.id === 'C0ALERTSPROD')?.has_unreads).toBe(false)

    const dmLatest = before.ims.find((c) => c.id === 'D0MAYA')!.latest!
    fake.markRead({ channel: 'D0MAYA', ts: dmLatest })
    expect((await socket.next(isType('im_marked'))).channel).toBe('D0MAYA')
    socket.close()
  })

  it('markThreadRead emits thread_marked and clears the thread unread', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const view = await client.ok('subscriptions.thread.getView', { limit: 50 })
    const thread = view.threads.find((t) => (t.unread_replies?.length ?? 0) > 0)!
    fake.markThreadRead({ channel: thread.root_msg.channel, threadTs: thread.root_msg.ts, ts: thread.root_msg.latest_reply! })
    const marked = await socket.next(isType('thread_marked'))
    expect(marked.subscription.thread_ts).toBe(thread.root_msg.ts)
    expect(marked.subscription.last_read).toBe(thread.root_msg.latest_reply)
    const after = await client.ok('subscriptions.thread.getView', { limit: 50 })
    expect(after.threads.find((t) => t.root_msg.ts === thread.root_msg.ts)?.unread_replies).toHaveLength(0)
    socket.close()
  })

  it('edit, delete and reactions from others arrive as events', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const injected = fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'typo hear' })
    await socket.next((f) => f.type === 'message' && f.ts === injected.ts)
    fake.editMessage({ channel: 'C0ENG', ts: injected.ts, text: 'typo here' })
    const changed = await socket.next(isMessageChanged)
    expect(changed.message.ts).toBe(injected.ts)
    expect(changed.message.text).toBe('typo here')
    expect(changed.message.edited?.user).toBe('U0SAM')
    expect(changed.previous_message?.text).toBe('typo hear')

    fake.addReaction({ channel: 'C0ENG', ts: injected.ts, name: 'eyes', user: 'U0LEO' })
    const reaction = await socket.next(isType('reaction_added'))
    expect(reaction.item).toEqual({ type: 'message', channel: 'C0ENG', ts: injected.ts })
    expect(reaction.item_user).toBe('U0SAM')

    fake.deleteMessage({ channel: 'C0ENG', ts: injected.ts })
    const deleted = await socket.next(isMessageDeleted)
    expect(deleted.deleted_ts).toBe(injected.ts)
    expect(fake.messages('C0ENG').some((m) => m.ts === injected.ts)).toBe(false)
    socket.close()
  })

  it('unknown frames reach the socket untouched', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    fake.emitFrame({ type: 'canvas_updated', canvas: 'F1' })
    const frame = await socket.next(isType('unknown'))
    expect(frame.raw).toEqual({ type: 'canvas_updated', canvas: 'F1' })
    socket.close()
  })

  it('the same controls work over HTTP', async () => {
    const socket = await client.connect()
    await socket.next(isType('hello'))
    const injected = (await client.control('injectMessage', { channel: 'D0SAM', user: 'U0SAM', text: 'over http' })) as { ts: string }
    const message = await socket.next((f) => f.type === 'message' && f.ts === injected.ts)
    expect(message.type).toBe('message')
    await client.control('force429', { method: 'client.counts', retryAfter: 3 })
    expect((await client.call('client.counts', {})).status).toBe(429)
    const now = (await client.control('advanceClock', { millis: 1000 })) as number
    expect(now).toBe(fake.now())
    const calls = (await client.control('calls')) as Array<{ method: string }>
    expect(calls.some((c) => c.method === 'injectMessage')).toBe(true)
    await expect(client.control('nope')).rejects.toThrow('unknown control nope')
    socket.close()
  })
})
