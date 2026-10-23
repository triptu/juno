/**
 * The Slack quirks the engine depends on, as the fake reproduces them. Each one
 * is recorded in docs/research or in a recorded response under
 * packages/slack-schema/test/fixtures/recorded. Everything else about the fake
 * is exercised by every engine test that boots against it.
 */
import { afterEach, expect, it } from 'bun:test'
import { compareTs, isMessagePosted, searchMatches, type MessagePostedEvent, type Ts } from '@juno/slack-schema'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { isType, TestClient } from './helpers.ts'

const fakes: Array<FakeSlack> = []
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close()
})

async function fakeSlack() {
  const fake = await startFakeSlack({ now: Date.UTC(2026, 9, 12, 9, 0, 0) })
  fakes.push(fake)
  return { fake, client: new TestClient(fake) }
}

it('conversations.replies repeats the root first on every page', async () => {
  const { client } = await fakeSlack()
  const history = await client.ok('conversations.history', { channel: 'C0ENG', limit: 100, ignore_replies: true })
  const root = history.messages.find((m) => (m.reply_count ?? 0) >= 6)!
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, limit: 3, ...(cursor === undefined ? {} : { cursor }) })
    expect(page.messages[0]?.ts).toBe(root.ts)
    for (const message of page.messages) seen.add(message.ts)
    cursor = page.has_more ? page.response_metadata!.next_cursor! : undefined
  } while (cursor !== undefined)
  expect(seen.size).toBe((root.reply_count ?? 0) + 1)
  // The root still takes one place when oldest selects only the latest reply.
  const tail = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, oldest: root.latest_reply!, inclusive: true, limit: 2 })
  expect<unknown>(tail.messages.map((m) => m.ts)).toEqual([root.ts, root.latest_reply])
})

it('subscriptions.thread.getView caps a page at 10 whatever limit says, and pages by current_ts', async () => {
  const { client } = await fakeSlack()
  const first = await client.ok('subscriptions.thread.getView', { limit: 100 })
  expect(first.threads).toHaveLength(10)
  expect(first.has_more).toBe(true)
  const all = await client.allThreadViews()
  const latest = (thread: (typeof all)[number]) => thread.root_msg.latest_reply!
  for (let i = 1; i < all.length; i++) expect(compareTs(latest(all[i - 1]!), latest(all[i]!))).toBe(1)
  const seen: Array<string> = []
  let current: Ts | undefined
  for (;;) {
    const page = await client.ok('subscriptions.thread.getView', { limit: 2, ...(current === undefined ? {} : { current_ts: current }) })
    seen.push(...page.threads.map((t) => t.root_msg.ts))
    if (!page.has_more) break
    current = latest(page.threads.at(-1)!)
  }
  expect(seen).toEqual(all.map((t) => t.root_msg.ts))
})

it('search.modules.messages pages by page number with no cursor, one message per item', async () => {
  const { fake, client } = await fakeSlack()
  const first = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 5, page: 1 })
  expect(searchMatches(first)).toHaveLength(5)
  expect(first.pagination?.page_count).toBeGreaterThan(1)
  expect(first.response_metadata).toBeUndefined()
  expect(first.items?.every((item) => item.messages?.length === 1)).toBe(true)
  const second = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 5, page: 2 })
  expect(searchMatches(second)[0]?.ts).not.toBe(searchMatches(first)[0]?.ts)
  const newestFirst = searchMatches(await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 50, sort: 'timestamp', sort_dir: 'desc' }))
  for (let i = 1; i < newestFirst.length; i++) expect(compareTs(newestFirst[i - 1]!.ts, newestFirst[i]!.ts)).toBe(1)
  const today = new Date(fake.now()).toISOString().slice(0, 10)
  expect(searchMatches(await client.ok('search.modules.messages', { module: 'messages', query: `is:thread after:${today}`, count: 50 }))).toHaveLength(0)
})

it('conversations.replies with cached_latest_updates sends only changed messages and lists the unchanged ids', async () => {
  const { fake, client } = await fakeSlack()
  const channel = 'C0ENG'
  const root = fake.injectMessage({ channel, text: 'Conditional root.' })
  const edited = fake.injectMessage({ channel, threadTs: root.ts, text: 'Original.' })
  const deleted = fake.injectMessage({ channel, threadTs: root.ts, text: 'Remove this.' })
  const reacted = fake.injectMessage({ channel, threadTs: root.ts, text: 'Reaction here.' })
  fake.addReaction({ channel, ts: reacted.ts, name: 'eyes' })
  const before = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: {} })
  const counts = await client.ok('client.counts', {})
  fake.editMessage({ channel, ts: edited.ts, text: 'Changed.' })
  fake.deleteMessage({ channel, ts: deleted.ts })
  fake.removeReaction({ channel, ts: reacted.ts, name: 'eyes' })
  const after = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: before.latest_updates ?? {} })
  expect(after.messages.find((m) => m.ts === edited.ts)?.text).toBe('Changed.')
  expect(after.messages.find((m) => m.ts === reacted.ts)?.reactions ?? []).toEqual([])
  expect(after.messages.some((m) => m.ts === deleted.ts)).toBe(false)
  // Edits move `updated` and deletions `history_invalid`; `latest` stays.
  const previous = counts.channels.find((c) => c.id === channel)!
  const next = (await client.ok('client.counts', {})).channels.find((c) => c.id === channel)!
  expect(next.latest).toBe(previous.latest)
  expect(compareTs(next.updated!, previous.updated!)).toBe(1)
  expect(compareTs(next.history_invalid!, previous.history_invalid!)).toBe(1)
  const versions = { ...before.latest_updates, ...after.latest_updates }
  const unchanged = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: versions, limit: 2 })
  expect(unchanged.messages).toEqual([])
  expect(unchanged.unchanged_messages).toHaveLength(2)
  expect(unchanged.has_more).toBe(true)
})

it('an incremental client.counts sends {id, last_read} for unchanged conversations, and a new Main message keeps updated', async () => {
  const { fake, client } = await fakeSlack()
  const full = await client.ok('client.counts', { thread_counts_by_channel: true })
  const fetched = full.counts_last_fetched!
  fake.advanceClock({ millis: 5_000 })
  const quiet = await client.ok('client.counts', { thread_counts_by_channel: true, counts_last_fetched: fetched + 1 })
  const partial = [...quiet.channels, ...quiet.ims, ...quiet.mpims]
  expect(partial.length).toBe(full.channels.length + full.ims.length + full.mpims.length)
  expect(partial.every((entry) => Object.keys(entry).toSorted().join(',') === 'id,last_read')).toBe(true)
  const marker = full.channels.find((c) => c.id === 'C0ENG')!.updated
  const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'New Main message.' })
  fake.markRead({ channel: 'D0MAYA', ts: fake.messages('D0MAYA').at(-1)!.ts })
  fake.joinChannel({ channel: 'C0SALES' })
  const changed = await client.ok('client.counts', { thread_counts_by_channel: true, counts_last_fetched: fetched + 1 })
  expect(changed.channels.filter((c) => c.has_unreads !== undefined).map((c) => c.id).toSorted()).toEqual(['C0ENG', 'C0SALES'])
  expect(changed.ims.filter((c) => c.has_unreads !== undefined).map((c) => c.id)).toEqual(['D0MAYA'])
  expect(changed.channels.find((c) => c.id === 'C0ENG')).toMatchObject({ latest: root.ts, updated: marker })
  fake.advanceClock({ millis: 2_000 })
  fake.injectMessage({ channel: 'C0ENG', threadTs: root.ts, text: 'A reply changes the root.' })
  const replied = await client.ok('client.counts', { counts_last_fetched: changed.counts_last_fetched! })
  expect(replied.channels.find((c) => c.id === 'C0ENG')!.updated).not.toBe(marker)
})

it('a reply by self follows the thread with one thread_subscribed', async () => {
  const { fake, client } = await fakeSlack()
  const socket = await client.connect()
  await socket.next(isType('hello'))
  const root = fake.messages('C0ENG').find((m) => m.text?.startsWith('checkout.spec'))!
  expect(fake.workspace.subscription('C0ENG', root.ts)?.subscribed).toBe(false)
  fake.injectMessage({ channel: 'C0ENG', user: fake.selfId, text: 'Yes, until Friday.', threadTs: root.ts })
  expect((await socket.next(isType('thread_subscribed'))).subscription.thread_ts).toBe(root.ts)
  fake.injectMessage({ channel: 'C0ENG', user: fake.selfId, text: 'Ping.', threadTs: root.ts })
  await socket.next((f) => f.type === 'message' && 'text' in f && f.text === 'Ping.')
  expect(socket.frames.some((f) => f.type === 'thread_subscribed')).toBe(false)
  socket.close()
})

it('a closed group DM is absent from counts until a message opens it, with no mpim_open', async () => {
  const { fake, client } = await fakeSlack()
  fake.addGroupDm({ id: 'G0OLD', users: ['U0MAYA', 'U0SAM'], open: false })
  expect((await client.ok('client.counts', { thread_counts_by_channel: true })).mpims.map((c) => c.id)).not.toContain('G0OLD')
  const socket = await client.connect()
  await socket.next(isType('hello'))
  fake.injectMessage({ channel: 'G0OLD', user: 'U0SAM', text: 'Picking this back up' })
  await socket.next((f) => f.type === 'message' && 'text' in f && f.text === 'Picking this back up')
  expect(socket.frames.some((f) => f.type === 'mpim_open' || f.type === 'mpim_joined')).toBe(false)
  expect((await client.ok('client.counts', { thread_counts_by_channel: true })).mpims.map((c) => c.id)).toContain('G0OLD')
  socket.close()
})

it('group_rename sends a partial channel; conversations.info has the whole one', async () => {
  const { fake, client } = await fakeSlack()
  const socket = await client.connect()
  await socket.next(isType('hello'))
  fake.renameChannel({ channel: 'C0HIRING', name: 'recruiting' })
  const renamed = await socket.next(isType('group_rename'))
  expect(Object.keys(renamed.channel).toSorted()).toEqual(['created', 'id', 'name', 'name_normalized'])
  expect((await client.ok('conversations.info', { channel: 'C0HIRING' })).channel).toMatchObject({ name: 'recruiting', is_private: true, is_member: true })
  socket.close()
})

it('a broadcast reply carries its root, and text is stored as the client escaped it', async () => {
  const { client } = await fakeSlack()
  const socket = await client.connect()
  await socket.next(isType('hello'))
  const root = (await client.ok('conversations.history', { channel: 'C0PLATFORM', limit: 10 })).messages.find((m) => (m.reply_count ?? 0) > 0)!
  await client.ok('chat.postMessage', { channel: 'C0PLATFORM', thread_ts: root.ts, reply_broadcast: true, text: 'p95 -&gt; 800ms &amp; rising', client_msg_id: 'uuid-bc-1' })
  const echo = await socket.next((f): f is MessagePostedEvent => isMessagePosted(f) && f.subtype === 'thread_broadcast')
  expect(echo.root?.ts).toBe(root.ts)
  expect(echo.text).toBe('p95 -&gt; 800ms &amp; rising')
  expect(JSON.stringify(echo.blocks)).toContain('p95 -> 800ms & rising')
  socket.close()
})

it('presence.set refuses auto, the public API value', async () => {
  const { fake, client } = await fakeSlack()
  const form = new FormData()
  form.set('token', client.credentials.token)
  form.set('presence', 'auto')
  const response = await fetch(`${fake.url}/api/presence.set`, { method: 'POST', body: form, headers: { cookie: `d=${client.credentials.cookie}` } })
  expect(await response.json()).toEqual({ ok: false, error: 'invalid_presence' })
})
