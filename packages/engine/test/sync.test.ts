// Sync end to end: the engine boots against the fake, the sidebar rows reach
// the state atoms over the port, and socket events update them live.
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { UndoCommand } from '@juno/contract'
import { CONVERSATIONS, SELF_ID, startFakeSlack } from '@juno/fake-slack'
import { prefs, Store, workspacePaths } from '@juno/store'
import { topicCountsAtom } from '@juno/state'
import { sleep, startTestEngine, waitFor, type RunningEngine } from './harness'
import {
  apiCalls,
  bootedEngine as boot,
  callMap,
  DAY,
  errorOf,
  quiet,
  readDb,
  restart,
  seedThread,
  storedFollow,
  subscribe,
  threadId as threadIdIn,
  tsOf,
  unsubscribe,
  valueOf,
  type SeededThread,
} from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const bootedEngine = (options: Parameters<typeof startTestEngine>[0] = {}) => boot(engines, options)

/** The quiet window, in the fixture's unit (minutes before now). */
const WINDOW = 7 * 24 * 60

/** The fixture conversations the self user is in, and the channels they are not in. */
const memberConversations = CONVERSATIONS.filter((c) => c.members.includes(SELF_ID))
const nonMemberChannels = CONVERSATIONS.filter((c) => !c.members.includes(SELF_ID)).map((c) => c.id)

/** A fresh `event_ts` for a frame a test emits. */
const eventTs = () => `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`

/** Member conversations with a Main message (not just a reply) inside the window: the ones cold boot reads history for. */
const activeMains = memberConversations.filter((c) => c.messages.some((m) => m.ago < WINDOW)).length

/** The topic id of a thread in the fake, by the start of its root's text. */
const threadId = (engine: RunningEngine, channel: string, prefix: string) => threadIdIn(engine.fake, channel, prefix)

/** Replays an undo the way the renderer's undo stack does: the command its tag names. */
const replay = (engine: RunningEngine, undo: UndoCommand) => (undo._tag === 'topics.subscribe' ? subscribe(engine, undo.id) : unsubscribe(engine, undo.id))

describe('cold boot', () => {
  it('discovers the fixture workspace: titles, previews, counts, tags and order', async () => {
    const engine = await bootedEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20 && list.every((r) => r.preview.sender !== ''), 'all rows named')

    // Newest activity first; every row is from a conversation the user is in.
    const order = rows.map((r) => r.lastActivityTs)
    expect(order.toSorted().toReversed()).toEqual(order)
    expect(rows.every((r) => r.section === 'recent')).toBe(true)

    const byTitle = (title: string) => rows.find((r) => r.title === title)
    const postgres = byTitle('Draft plan is in the doc.…')
    expect(postgres).toMatchObject({
      kind: 'thread',
      preview: { sender: 'Dev', text: 'Booked 2–4pm. Will post results here.' },
      channel: { id: 'C0ENG', kind: 'public', name: 'eng', label: '#eng', tint: 'public' },
      messageCount: 7,
      unreadCount: 0,
      unreadExact: true,
      mentionsMe: false,
      tags: [],
      subscribed: true,
      titleSource: 'fallback',
    })
    expect(postgres?.participants.map((p) => p.name)).toEqual(['Dev', 'Leo', 'Tushar'])
    expect(postgres?.participants[0]?.avatarUrl).toContain('/avatars/U0DEV.svg')

    // Main rows carry the channel label as title and the Main tag; counts come from the read pointer.
    // Main is "subscribed" until the user unsubscribes it (a client-only flag).
    const eng = byTitle('#eng')
    expect(eng).toMatchObject({ kind: 'main', tags: ['main'], unreadCount: 2, unreadExact: true, mentionsMe: false, subscribed: true })
    expect(eng?.preview).toEqual({ sender: 'Dev', text: '@Leo I think the preview environments never shut down. Will check.' })
    expect(eng?.channel.icon).toBeTruthy()
    expect(eng?.channel.color).toBeTruthy()

    // A mention of me in an unread reply.
    const rina = byTitle('Rina finished the onsite. Panel notes…')
    expect(rina).toMatchObject({ channel: { kind: 'private', tint: 'private', label: '#hiring' }, unreadCount: 2, mentionsMe: true })

    // DMs: the partner's name is the label and the tile.
    const maya = byTitle('Maya')
    expect(maya).toMatchObject({ kind: 'main', channel: { kind: 'im', tint: 'dm', label: 'Maya' } })
    expect(maya?.channel.partner?.name).toBe('Maya')
    expect(byTitle('Maya, Leo')).toMatchObject({ channel: { kind: 'mpim', tint: 'dm' } })

    // Threads the user does not follow are not rows, even when active; the mention in the flaky thread
    // was there before the first sign-in, so the thread started read and stays out too.
    expect(byTitle('checkout.spec failed again on main. Third…')).toBeUndefined()
    expect(byTitle("We have 142 flags. 61 haven't…")).toBeUndefined()
    expect(rows.filter((r) => r.kind === 'thread').every((r) => r.subscribed)).toBe(true)

    // A followed thread in a channel whose Main went quiet: both the thread and the Main show.
    const finance = byTitle('Finance wants the 2027 plan by…')
    expect(finance).toMatchObject({ kind: 'thread', subscribed: true, unreadCount: 1, mentionsMe: true, channel: { label: '#leadership' } })
    const leadership = byTitle('#leadership')
    expect(leadership).toMatchObject({ kind: 'main', unreadCount: 0 })
    expect(leadership!.lastActivityAt).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Quiet topics stay out: nothing older than 7 days, except a Main kept alive by its threads.
    expect(byTitle('Lag alerts are firing on the…')).toBeUndefined()
    expect(byTitle('Icon refresh is merged.')).toBeUndefined()
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    expect(rows.filter((r) => r.id !== leadership!.id).every((r) => r.lastActivityAt > weekAgo)).toBe(true)

    // A never-read channel shows what is stored and says the count is not exact.
    expect(byTitle('#alerts-prod')).toMatchObject({ unreadCount: 9, unreadExact: false })
  })

  it('shows exactly the rows of spec section 5: active Main rows and followed threads, no unfollowed thread at first sign-in', async () => {
    const engine = await bootedEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20, 'rows')
    const expected = new Set<string>()
    for (const c of memberConversations) {
      const rootTs = (text: string) => engine.fake.messages(c.id).find((m) => m.text === text)!.ts
      // Main: activity of any kind inside the window, replies in its threads included, or unread.
      const active = c.messages.some((m) => m.ago < WINDOW || (m.replies ?? []).some((r) => r.ago < WINDOW))
      if (active || (c.unread ?? 0) > 0) expected.add(`m:${c.id}`)
      // Threads: only the ones the user follows, inside the window or unread. An unfollowed thread starts read, so a
      // mention in it before the first sign-in does not bring it in.
      for (const m of c.messages) {
        if (m.replies === undefined || m.replies.length === 0 || m.thread?.subscribed === false) continue
        if (m.replies.some((r) => r.ago < WINDOW) || (m.thread?.unread ?? 0) > 0) expected.add(`t:${c.id}:${rootTs(m.text)}`)
      }
    }
    expect(new Set(rows.map((r) => r.id))).toEqual(expected)
    expect(rows.map((r) => r.id)).toHaveLength(expected.size)
  })

  it('spends an exact call budget: one history call per active conversation, every getView page, no call per row', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    await quiet(engine)
    const history = apiCalls(engine, 'conversations.history')
    expect(new Set(history.map((c) => c.args['channel'])).size).toBe(history.length)
    expect(callMap(engine)).toEqual({
      'api:auth.test': 1,
      'api:client.getWebSocketURL': 1,
      'api:api.getFlannelHttpUrl': 1,
      'api:client.userBoot': 1,
      'api:users.prefs.get': 1,
      'api:client.counts': 1,
      // The fixture follows 12 threads; Slack pages them 10 at a time. Two pages back to the window at the
      // boot, then the complete pass after it (against the fake it runs with every catch-up).
      'api:subscriptions.thread.getView': 4,
      // A conversation whose only recent activity is a reply under an older root has nothing for history in the window.
      'api:conversations.history': activeMains,
      // The latest reply of the unfollowed threads with recent activity, for their preview.
      'api:conversations.replies': 2,
      // Discovery over the window at the end of the cold boot: more than 50 thread messages, so two pages.
      'api:search.modules.messages': 2,
      'edge:users/info': 1,
    })
  })

  it('filters by kind, unread and scope, and counts for the dots', async () => {
    const engine = await bootedEngine()
    const all = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const dms = await engine.rows({ kind: 'dms', unreadOnly: false })
    expect(dms.length).toBeGreaterThan(0)
    expect(dms.every((r) => r.channel.kind === 'im' || r.channel.kind === 'mpim')).toBe(true)
    const channels = await engine.rows({ kind: 'channels', unreadOnly: false })
    expect(channels.length + dms.length).toBe(all.length)
    const unread = await engine.rows({ kind: 'all', unreadOnly: true })
    expect(unread.length).toBe(all.filter((r) => r.unreadCount > 0).length)
    const scoped = await engine.rows({ kind: 'all', unreadOnly: false, scope: 'C0ENG' })
    expect(scoped.map((r) => r.channel.id)).toEqual(scoped.map(() => 'C0ENG'))
    expect(scoped.length).toBe(all.filter((r) => r.channel.id === 'C0ENG').length)

    const unmount = engine.registry.mount(topicCountsAtom())
    try {
      const counts = await waitFor(() => {
        const result = engine.registry.get(topicCountsAtom())
        return result._tag === 'Success' ? result.value : undefined
      })
      expect(counts.channelsUnread).toBe(all.filter((r) => r.unreadCount > 0 && r.channel.kind !== 'im' && r.channel.kind !== 'mpim').length)
      expect(counts.dmsUnread).toBe(all.filter((r) => r.unreadCount > 0 && (r.channel.kind === 'im' || r.channel.kind === 'mpim')).length)
    } finally {
      unmount()
    }
  })
})

describe('membership', () => {
  it('comes from client.counts: channels the user is not in never reach the sidebar and cost no history call', async () => {
    const engine = await bootedEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20, 'rows')
    // The fake's userBoot lists every channel, like the real one; the non-member ones have recent threads.
    expect(nonMemberChannels.length).toBeGreaterThan(0)
    const memberIds = new Set(memberConversations.map((c) => c.id))
    expect(rows.every((r) => memberIds.has(r.channel.id))).toBe(true)
    for (const id of nonMemberChannels) expect(rows.find((r) => r.channel.id === id)).toBeUndefined()
    expect(rows.find((r) => r.title === '#sales')).toBeUndefined()
    const history = apiCalls(engine, 'conversations.history').map((c) => c.args['channel'])
    for (const id of nonMemberChannels) expect(history).not.toContain(id)
    // Every member conversation with recent activity of any kind (thread replies included) has its Main row.
    const recent = (c: (typeof memberConversations)[number]) => c.messages.some((msg) => msg.ago < 7 * 24 * 60 || (msg.replies ?? []).some((r) => r.ago < 7 * 24 * 60))
    for (const c of memberConversations) {
      expect(rows.some((r) => r.kind === 'main' && r.channel.id === c.id), c.id).toBe(recent(c))
    }
  })

  it('follows the membership events: a joined channel shows up, a left one disappears', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((list) => list.length >= 20, 'rows')

    engine.fake.joinChannel({ channel: 'C0SALES' })
    engine.fake.injectMessage({ channel: 'C0SALES', user: 'U0ELENA', text: 'Welcome to sales.' })
    const joined = await engine.rowsUntil((list) => list.some((r) => r.channel.id === 'C0SALES'), 'the joined channel')
    expect(joined.find((r) => r.channel.id === 'C0SALES')).toMatchObject({ kind: 'main', title: '#sales', preview: { text: 'Welcome to sales.' } })

    engine.fake.leaveChannel({ channel: 'C0SALES' })
    const left = await engine.rowsUntil((list) => !list.some((r) => r.channel.id === 'C0SALES'), 'the left channel gone')
    expect(left.length).toBeGreaterThanOrEqual(20)
  })
})

describe('warm boot', () => {
  it('uses incremental calls and picks up what changed while the engine was down', async () => {
    const first = await bootedEngine()
    await first.rowsUntil((rows) => rows.length >= 20, 'rows')
    const { fake, userData } = first
    const credentials = fake.credentials()
    // The harness closes the fake and the directory only for the last engine; keep both for the second boot.
    const reuse = { userData, fake, credentials }
    await first.handle.stop()
    engines.splice(engines.indexOf(first), 1)

    // Activity while the app is quit: a new Main message and a reply in a thread we do not follow.
    const flakyRoot = fake.messages('C0ENG').find((m) => m.text?.startsWith('checkout.spec'))!
    fake.injectMessage({ channel: 'C0PRODUCT', user: 'U0PRIYA', text: 'Pricing page copy is live.' })
    fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Still flaky after the wait?', threadTs: flakyRoot.ts })
    // A reply in a public channel the user is not in: search returns it, the sync must drop it.
    const salesRoot = fake.messages('C0SALES').find((m) => (m.reply_count ?? 0) > 0)!
    fake.injectMessage({ channel: 'C0SALES', user: 'U0MAYA', text: 'Forecast is in the deck.', threadTs: salesRoot.ts })
    fake.resetCalls()

    const second = await startTestEngine({ reuse, initial: () => credentials })
    engines.push(second)
    await second.status('ready')
    await second.phase('live', 30_000)
    const rows = await second.rowsUntil((list) => list.some((r) => r.preview.text === 'Pricing page copy is live.'), 'the new Main message')
    expect(rows.find((r) => r.title === '#product')).toMatchObject({ unreadCount: 1 })
    expect(rows.find((r) => r.channel.id === 'C0SALES')).toBeUndefined()
    // The reply in the unfollowed thread was discovered and indexed (it is a topic), but it is not a sidebar row.
    expect(rows.find((r) => r.title === 'checkout.spec failed again on main. Third…')).toBeUndefined()
    const cache = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
    const flaky = cache.prepare(`SELECT message_count, unread_count FROM topic_index WHERE topic_id = ?`).get(`t:C0ENG:${flakyRoot.ts}`)
    cache.close()
    expect(flaky).toMatchObject({ message_count: 7, unread_count: 1 })

    // Only the conversation whose latest moved was fetched; the thread reply came from the discovery search.
    await quiet(second)
    expect(apiCalls(second, 'conversations.history').map((c) => c.args['channel'])).toEqual(['C0PRODUCT'])
    expect(callMap(second)).toEqual({
      'api:auth.test': 1,
      'api:client.getWebSocketURL': 1,
      'api:client.userBoot': 1,
      'api:client.counts': 1,
      'api:conversations.history': 1,
      // Back to the window, then the complete pass.
      'api:subscriptions.thread.getView': 4,
      'api:search.modules.messages': 1,
      // The searched reply is newer than its root's counters, so the root is fetched for Slack's reply_count.
      'api:conversations.replies': 1,
    })

    await second.stop()
    engines.splice(engines.indexOf(second), 1)
    await fake.close()
  })
})

describe('realtime', () => {
  it('a reply from the socket updates one row and leaves the others as they were', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const postgres = before.find((r) => r.title === 'Draft plan is in the doc.…')!
    const other = before.find((r) => r.title === '#deploys')!

    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Dry run passed. <@U0TUSHAR> we are good for Thursday.', threadTs: postgres.id.split(':')[2]! })

    const after = await engine.rowsUntil((rows) => rows[0]?.id === postgres.id && rows[0].messageCount === 8, 'the reply on top')
    expect(after[0]).toMatchObject({
      preview: { sender: 'Leo', text: 'Dry run passed. @Tushar we are good for Thursday.' },
      unreadCount: 1,
      unreadExact: true,
      mentionsMe: true,
    })
    expect(after[0]!.rev).not.toBe(postgres.rev)
    // The untouched row kept its object: the delta carried only the changed row.
    expect(after.find((r) => r.id === other.id)).toBe(other)
  })

  it('a read mark from another client clears the unread count by the conflict rule', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const eng = before.find((r) => r.title === '#eng')!
    expect(eng.unreadCount).toBe(2)
    engine.fake.markRead({ channel: 'C0ENG', ts: eng.lastActivityTs })
    const after = await engine.rowsUntil((rows) => rows.find((r) => r.id === eng.id)?.unreadCount === 0, 'eng read')
    expect(after.find((r) => r.id === eng.id)).toMatchObject({ unreadCount: 0, mentionsMe: false })
  })

  it('a message after a resolve brings the topic back with the Reopened tag', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const pricing = before.find((r) => r.title === 'Final copy for pricing is in.…')!

    // The overlay exists before the resolve command does: write the resolve the way the command will.
    const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'))
    db.prepare(`INSERT INTO topic_overlay (topic_id, resolved_at, resolved_activity_ts) VALUES (?, ?, ?)`).run(pricing.id, String(Date.now()), pricing.lastActivityTs)
    db.close()

    engine.fake.injectMessage({ channel: 'C0PRODUCT', user: 'U0MAYA', text: 'Legal signed off.', threadTs: pricing.id.split(':')[2]! })
    const after = await engine.rowsUntil((rows) => rows.find((r) => r.id === pricing.id)?.tags.includes('reopened') === true, 'the reopened tag')
    expect(after.find((r) => r.id === pricing.id)).toMatchObject({ tags: ['reopened'], resolved: false, preview: { sender: 'Maya', text: 'Legal signed off.' } })
  })

  it('an edit and a delete reach the row through the merge guards', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const posted = engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'typo hear' })
    await engine.rowsUntil((rows) => rows[0]?.preview.text === 'typo hear', 'the new DM')
    engine.fake.editMessage({ channel: 'D0SAM', ts: posted.ts, text: 'typo here' })
    await engine.rowsUntil((rows) => rows[0]?.preview.text === 'typo here', 'the edit')
    engine.fake.deleteMessage({ channel: 'D0SAM', ts: posted.ts })
    const rows = await engine.rowsUntil((list) => list.find((r) => r.title === 'Sam')?.preview.text !== 'typo here', 'the delete')
    expect(rows.find((r) => r.title === 'Sam')?.preview).toEqual({ sender: 'Sam', text: 'Notes from today: promo packet for Dev, on-call load, Q1 planning.' })
  })

  it('goes offline while the socket is down and comes back live after a reconnect', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await sleep(50)
    expect(engine.fake.socketCount()).toBe(1)
  })
})

describe('subscriptions (spec section 5, "Subscribe works on any thread")', () => {
  it('subscribing to an unfollowed active thread adds it live, unsubscribing removes it, and the undo brings it back', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0PLATFORM', 'We have 142 flags')
    const threadTs = id.split(':')[2]!
    expect(before.find((r) => r.id === id)).toBeUndefined()
    engine.fake.resetCalls()

    expect(valueOf(await subscribe(engine, id))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    const added = await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'the subscribed thread')
    expect(added.find((r) => r.id === id)).toMatchObject({ kind: 'thread', subscribed: true, title: "We have 142 flags. 61 haven't…", channel: { id: 'C0PLATFORM' }, tags: [] })
    // Mirrored to Slack with the read pointer (research section 3); Slack now lists the thread as followed.
    const adds = apiCalls(engine, 'subscriptions.thread.add')
    expect(adds).toHaveLength(1)
    expect(adds[0]!.args).toMatchObject({ channel: 'C0PLATFORM', thread_ts: threadTs })
    expect(adds[0]!.args['last_read']).toBeTruthy()
    expect(engine.fake.workspace.subscription('C0PLATFORM', threadTs)?.subscribed).toBe(true)
    // Subscribing again changes nothing, so there is nothing to undo.
    expect(valueOf(await subscribe(engine, id))).toEqual({})
    expect(apiCalls(engine, 'subscriptions.thread.add')).toHaveLength(1)

    const result = valueOf(await unsubscribe(engine, id))
    expect(result).toEqual({ undo: { _tag: 'topics.subscribe', id } })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone')
    expect(apiCalls(engine, 'subscriptions.thread.remove').map((c) => c.args)).toMatchObject([{ channel: 'C0PLATFORM', thread_ts: threadTs }])
    expect(engine.fake.workspace.subscription('C0PLATFORM', threadTs)?.subscribed).toBe(false)

    expect(valueOf(await replay(engine, result.undo!))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    const back = await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'the thread back')
    expect(back.find((r) => r.id === id)).toMatchObject({ subscribed: true, tags: [] })
  })

  it('a reply by the user follows the thread: it becomes a row with the reply as preview', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'checkout.spec')
    engine.fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: 'Yes, until Friday.', threadTs: id.split(':')[2]! })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the thread the user replied in')
    expect(rows.find((r) => r.id === id)).toMatchObject({ subscribed: true, messageCount: 7, tags: [], preview: { sender: 'You', text: 'Yes, until Friday.' } })
  })

  it('an unfollow from another client arrives as an event and removes the row', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    expect(before.find((r) => r.id === id)).toMatchObject({ subscribed: true })
    engine.fake.workspace.unsubscribe('C0ENG', id.split(':')[2]! as Parameters<typeof engine.fake.workspace.unsubscribe>[1])
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the unfollowed thread gone')
    expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
  })

  it('a rejected mirror call reverts the local change and returns the typed error', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0PLATFORM', 'We have 142 flags')
    // A final answer, not one of the transient errors the client retries.
    engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })

    expect(errorOf(await subscribe(engine, id))).toMatchObject({ _tag: 'Rejected', code: 'not_allowed' })
    // The store forgot the follow again: Slack's silence is stored as silence, so the next subscribe is a change.
    const cache = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'), { readOnly: true })
    const subs = cache.prepare(`SELECT subscribed FROM thread_subs WHERE channel = ? AND thread_ts = ?`).all('C0PLATFORM', id.split(':')[2]!)
    cache.close()
    expect(subs).toEqual([])
    expect(engine.fake.workspace.subscription('C0PLATFORM', id.split(':')[2]!)?.subscribed).toBe(false)
    // A later message elsewhere proves the list moved on without the thread.
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Lunch?' })
    const rows = await engine.rowsUntil((list) => list[0]?.preview.text === 'Lunch?', 'the DM')
    expect(rows.find((r) => r.id === id)).toBeUndefined()

    expect(valueOf(await subscribe(engine, id))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the thread after the retry')
  })

  it('unsubscribing a Main hides it with no Slack call, and the undo shows it again', async () => {
    const engine = await bootedEngine()
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = 'm:C0DEPLOYS'
    expect(before.find((r) => r.id === id)).toMatchObject({ kind: 'main', subscribed: true })
    engine.fake.resetCalls()

    const result = valueOf(await unsubscribe(engine, id))
    expect(result).toEqual({ undo: { _tag: 'topics.subscribe', id } })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the Main gone')
    expect(valueOf(await replay(engine, result.undo!))).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    const back = await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'the Main back')
    expect(back.find((r) => r.id === id)).toMatchObject({ subscribed: true, tags: ['main'] })
    expect(apiCalls(engine).filter((c) => c.method.startsWith('subscriptions.thread.'))).toHaveLength(0)
  })

  it('an unknown topic is NotFound and nothing is called', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    engine.fake.resetCalls()
    expect(errorOf(await subscribe(engine, 't:C0ENG:1.000'))).toMatchObject({ _tag: 'NotFound' })
    expect(errorOf(await unsubscribe(engine, 'm:C0NOPE'))).toMatchObject({ _tag: 'NotFound' })
    expect(apiCalls(engine)).toHaveLength(0)
  })
})

describe('follow state (review M3 finding 1, specs/follow.qnt)', () => {
  it('a thread unfollowed in Slack while Juno was closed leaves the sidebar at the next start, and comes back when followed again', async () => {
    const first = await bootedEngine()
    const id = threadId(first, 'C0ENG', 'Draft plan is in the doc.')
    expect((await first.rowsUntil((rows) => rows.length >= 20, 'rows')).find((r) => r.id === id)).toMatchObject({ subscribed: true })

    const second = await restart(engines, first, (fake) => fake.unfollowThread({ channel: 'C0ENG', threadTs: tsOf(id) }))
    await second.rowsUntil((rows) => rows.length >= 20 && !rows.some((r) => r.id === id), 'the unfollowed thread gone')
    expect(storedFollow(second, 'C0ENG', tsOf(id))).toBe(0)
    // The thread was missing from the complete getView list, so its root was asked; nothing else was.
    expect(apiCalls(second, 'conversations.replies').map((c) => c.args['ts'])).toEqual([tsOf(id)])

    const third = await restart(engines, second, (fake) => fake.followThread({ channel: 'C0ENG', threadTs: tsOf(id) }))
    await third.rowsUntil((rows) => rows.some((r) => r.id === id), 'the thread followed again')
    expect(storedFollow(third, 'C0ENG', tsOf(id))).toBe(1)
  })

  it('a getView page in flight cannot bring back a thread the user unsubscribed meanwhile', async () => {
    const engine = await bootedEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20, 'rows')
    const newest = rows.filter((r) => r.kind === 'thread').toSorted((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))[0]!
    // The reconnect's first getView page is taken while the thread is still followed, and answered late.
    engine.fake.holdNext({ method: 'subscriptions.thread.getView' })
    engine.fake.dropSocket()
    await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.getView' }) === 1 ? true : undefined), 20_000, 'the held page')
    expect(valueOf(await unsubscribe(engine, newest.id))).toEqual({ undo: { _tag: 'topics.subscribe', id: newest.id } })
    await engine.rowsUntil((list) => !list.some((r) => r.id === newest.id), 'the thread gone')
    engine.fake.release()
    await engine.phase('live', 20_000)
    await quiet(engine)
    expect((await engine.rows()).some((r) => r.id === newest.id)).toBe(false)
    expect(storedFollow(engine, newest.channel.id, tsOf(newest.id))).toBe(0)
    expect(engine.fake.workspace.subscription(newest.channel.id, tsOf(newest.id))?.subscribed).toBe(false)
  })

  it('a follow last seen before the window is checked with Slack when its thread gets a reply', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    // Juno last saw this follow a month ago, and it was dropped elsewhere since without an event reaching Juno.
    const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
    db.prepare('UPDATE thread_subs SET observed_at = ? WHERE channel = ? AND thread_ts = ?').run(`${Math.floor(Date.now() / 1000) - 30 * 86_400}.000000`, 'C0ENG', tsOf(id))
    db.close()
    engine.fake.workspace.subscriptions.get(`C0ENG:${tsOf(id)}`)!.subscribed = false
    engine.fake.resetCalls()
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Any news on the dry run?', threadTs: tsOf(id) })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the stale follow gone')
    expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(0)
    expect(apiCalls(engine, 'conversations.replies').map((c) => c.args['ts'])).toContain(tsOf(id))
  })

  it('a followed thread older than the quiet window becomes a row when it gets a reply', async () => {
    let old: SeededThread | undefined
    const engine = await bootedEngine({
      initial: (fake) => {
        old = seedThread(fake, { channel: 'C0ENG', text: 'Old capacity plan', ago: 20 * DAY, replies: [20 * DAY, 19 * DAY], follow: true })
        return fake.signIn()
      },
    })
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    expect((await engine.rows()).some((r) => r.id === old!.id)).toBe(false)
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Revisiting this for Q3.', threadTs: old!.ts })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === old!.id), 'the old followed thread')
    expect(rows.find((r) => r.id === old!.id)).toMatchObject({ subscribed: true, unreadCount: 1, preview: { text: 'Revisiting this for Q3.' } })
  })

  it('a reply from Slack while a Subscribe is in flight does not hide the intent, and Slack is asked again afterwards', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0PLATFORM', 'We have 142 flags')
    engine.fake.holdNext({ method: 'subscriptions.thread.add' })
    const pending = subscribe(engine, id)
    await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), 10_000, 'the held add')
    // Slack accepted the add (its handler ran and sent thread_subscribed), then another client unfollowed.
    engine.fake.unfollowThread({ channel: 'C0PLATFORM', threadTs: tsOf(id) })
    await waitFor(() => (engine.fake.frames.some((f) => f.type === 'thread_unsubscribed') ? true : undefined), 10_000, 'the unfollow event')
    await sleep(200)
    // The command is still pending, so its intent stays visible.
    expect((await engine.rows()).some((r) => r.id === id)).toBe(true)
    engine.fake.release()
    expect(valueOf(await pending)).toEqual({ undo: { _tag: 'topics.unsubscribe', id } })
    // The noted observation made the command ask for the root: Slack's newer unfollow wins.
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone after the refresh')
    expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBe(0)
  })
})

describe('follow events without a time (specs/follow.qnt)', () => {
  it('an undated thread_unsubscribed is not trusted: Slack is asked for the root, and its answer wins', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    engine.fake.resetCalls()
    // Slack still has the thread followed; the frame carries no event_ts.
    engine.fake.emitFrame({ type: 'thread_unsubscribed', subscription: { type: 'thread', channel: 'C0ENG', thread_ts: tsOf(id), active: false } })
    await waitFor(() => (apiCalls(engine, 'conversations.replies').some((c) => c.args['ts'] === tsOf(id)) ? true : undefined), 10_000, 'the root lookup')
    await quiet(engine)
    expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(1)
    expect((await engine.rows()).some((r) => r.id === id)).toBe(true)
  })
})

describe('followed threads past one getView page (review M3 finding 2)', () => {
  it('a warm boot reads every page: reads on another device clear, and a follow made elsewhere appears', async () => {
    const threads: Array<SeededThread> = []
    const first = await bootedEngine({
      initial: (fake) => {
        for (let i = 0; i < 25; i++) {
          threads.push(seedThread(fake, { channel: 'C0PLATFORM', text: `Rollout step ${i + 1}`, ago: 3 * DAY, replies: [2 * DAY + i * 60_000, DAY + i * 60_000], follow: true, unread: 1 }))
        }
        return fake.signIn()
      },
    })
    const ids = new Set(threads.map((t) => t.id))
    await first.rowsUntil((rows) => rows.filter((r) => ids.has(r.id) && r.unreadCount === 1).length === 25, 'the 25 unread threads')

    const flaky = threadId(first, 'C0ENG', 'checkout.spec')
    const second = await restart(engines, first, (fake) => {
      // Read on the phone overnight, and a thread followed there.
      for (const t of threads) fake.markThreadRead({ channel: t.channel, threadTs: t.ts, ts: fake.workspace.replies(t.channel, t.ts as never).at(-1)!.ts })
      fake.followThread({ channel: 'C0ENG', threadTs: tsOf(flaky) })
    })
    const rows = await second.rowsUntil(
      (list) => list.filter((r) => ids.has(r.id) && r.unreadCount === 0).length === 25 && list.some((r) => r.id === flaky),
      'every thread read and the new follow',
    )
    expect(rows.find((r) => r.id === flaky)).toMatchObject({ subscribed: true })
    await quiet(second)
    // 12 fixture follows, 25 seeded and the new one: four pages of ten back to the window, and four in the complete pass.
    expect(apiCalls(second, 'subscriptions.thread.getView')).toHaveLength(8)
  })
})

describe('search matches (review M3 finding 3)', () => {
  it('the discovery sweep keeps the files and blocks of a stored reply', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    const file = { id: 'F0PLAN', name: 'plan.pdf', title: 'plan.pdf', mimetype: 'application/pdf', filetype: 'pdf', size: 1024 }
    const posted = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Here is the plan.', threadTs: tsOf(id) as never, files: [file] })
    await engine.rowsUntil((rows) => rows.find((r) => r.id === id)?.preview.text === 'Here is the plan.', 'the reply')
    const stored = () =>
      readDb(engine, 'cache.db', (db) => db.prepare('SELECT files_json, blocks_json FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', posted.ts)) as {
        files_json: string | null
        blocks_json: string | null
      }
    const before = stored()
    expect(before.files_json).toContain('F0PLAN')
    expect(before.blocks_json).not.toBeNull()

    engine.fake.resetCalls()
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await quiet(engine)
    // The sweep matched the reply (search has no files or blocks) and left the stored message alone.
    expect(apiCalls(engine, 'search.modules.messages').length).toBeGreaterThan(0)
    expect(stored()).toEqual(before)
  })
})

describe('an expired session (review M3 finding 4)', () => {
  it('found by the catch-up after a reconnect ends the session as session-expired', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    // The socket reconnects with its reconnect_url; the first API call of the catch-up meets the expired session.
    engine.fake.forceError({ method: 'client.counts', error: 'invalid_auth', times: 10 })
    engine.fake.dropSocket()
    await engine.status('authRequired')
    await engine.phase('session-expired')
  })
})

describe('subscriptions after a failure (review M3 finding 10)', () => {
  it('a rejected unsubscribe asks Slack and keeps the follow Slack still has', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    engine.fake.forceError({ method: 'subscriptions.thread.remove', error: 'not_allowed' })
    expect(errorOf(await unsubscribe(engine, id))).toMatchObject({ _tag: 'Rejected', code: 'not_allowed' })
    await engine.rowsUntil((rows) => rows.some((r) => r.id === id), 'the thread back')
    expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(1)
    expect(apiCalls(engine, 'conversations.replies').some((c) => c.args['ts'] === tsOf(id))).toBe(true)
  })

  it('a failed Subscribe does not undo a follow Slack made meanwhile', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0PLATFORM', 'We have 142 flags')
    engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })
    engine.fake.holdNext({ method: 'subscriptions.thread.add' })
    const pending = subscribe(engine, id)
    await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), 10_000, 'the held add')
    // Another client follows the thread while Juno's call is failing.
    engine.fake.followThread({ channel: 'C0PLATFORM', threadTs: tsOf(id) })
    await sleep(200)
    engine.fake.release()
    expect(errorOf(await pending)).toMatchObject({ _tag: 'Rejected' })
    await quiet(engine)
    expect((await engine.rows()).some((r) => r.id === id)).toBe(true)
    expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBe(1)
  })

  it('commands on one thread run in order: an Unsubscribe waits for a Subscribe whose call then fails', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0PLATFORM', 'We have 142 flags')
    engine.fake.forceError({ method: 'subscriptions.thread.add', error: 'not_allowed' })
    engine.fake.holdNext({ method: 'subscriptions.thread.add' })
    const first = subscribe(engine, id)
    await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.add' }) === 1 ? true : undefined), 10_000, 'the held add')
    const second = unsubscribe(engine, id)
    await sleep(200)
    expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
    engine.fake.release()
    expect(errorOf(await first)).toMatchObject({ _tag: 'Rejected' })
    // By its turn the thread is unfollowed again, so there is nothing to change and nothing to undo.
    expect(valueOf(await second)).toEqual({})
    expect(apiCalls(engine, 'subscriptions.thread.remove')).toHaveLength(0)
    expect(storedFollow(engine, 'C0PLATFORM', tsOf(id))).toBeUndefined()
  })

  it('subscribing to a thread Juno has no read pointer for sends the root as last_read', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Who owns the flaky runner?' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Platform, I think.', threadTs: root.ts })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Confirmed.', threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`
    await waitFor(
      () => (readDb(engine, 'cache.db', (db) => db.prepare('SELECT message_count FROM topic_index WHERE topic_id = ?').get(id)) as { message_count: number } | undefined)?.message_count === 3 || undefined,
      10_000,
      'the thread indexed',
    )
    valueOf(await subscribe(engine, id))
    expect(apiCalls(engine, 'subscriptions.thread.add').at(-1)!.args['last_read']).toBe(root.ts)
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the thread')
    expect(rows.find((r) => r.id === id)).toMatchObject({ unreadCount: 2 })
  })
})

describe('cold boot details (review M3 finding 10)', () => {
  it('a mention that arrives while history is loading stays unread', async () => {
    const engine = await startTestEngine({
      initial: (fake) => {
        fake.holdNext({ method: 'conversations.history' })
        return fake.signIn()
      },
    })
    engines.push(engine)
    await engine.status('ready')
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the first history page held')
    const id = threadId(engine, 'C0ENG', 'checkout.spec')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: '<@U0TUSHAR> can you take a look?', threadTs: tsOf(id) })
    await sleep(100)
    engine.fake.release()
    await engine.phase('live', 30_000)
    // Unfollowed, but an unread mention brings it in; the replies before the boot count as read.
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the mentioned thread')
    expect(rows.find((r) => r.id === id)).toMatchObject({ mentionsMe: true, unreadCount: 1, subscribed: false })
  })

  it('an interrupted cold boot does not fetch again the history it already has', async () => {
    const engine = await startTestEngine({
      initial: (fake) => {
        fake.holdNext({ method: 'conversations.history' })
        return fake.signIn()
      },
    })
    engines.push(engine)
    await engine.status('ready')
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the first history page held')
    // The first conversation's page lands; the second keeps failing (every retry), so the boot fails and waits 30 s.
    engine.fake.forceError({ method: 'conversations.history', error: 'internal_error', times: 3 })
    engine.fake.release()
    await engine.phase('offline', 30_000)
    expect(apiCalls(engine, 'conversations.history').filter((c) => c.ok)).toHaveLength(1)
    engine.fake.resetCalls()
    // A force_reload boots again at once, without the conversation it already has.
    engine.fake.emitFrame({ type: 'force_reload', event_ts: eventTs() })
    await engine.phase('live', 30_000)
    await quiet(engine)
    expect(apiCalls(engine, 'conversations.history')).toHaveLength(activeMains - 1)
    expect((await engine.rowsUntil((rows) => rows.length >= 20, 'rows')).length).toBeGreaterThanOrEqual(20)
  })

  it('finishes a cold boot whose discovery sweep fails, and the next sweep searches the same gap', async () => {
    const engine = await startTestEngine({
      initial: (fake) => {
        fake.forceError({ method: 'search.modules.messages', error: 'not_allowed' })
        return fake.signIn()
      },
    })
    engines.push(engine)
    await engine.phase('live', 30_000)
    await quiet(engine)
    const searches = () => apiCalls(engine, 'search.modules.messages')
    expect(searches().map((c) => c.ok)).toEqual([false])
    engine.fake.resetCalls()
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await quiet(engine)
    // The catch-up searched from the start of the window again, not from the failed boot.
    const query = String(searches()[0]!.args['query'])
    const after = Date.parse(/after:(\d{4}-\d{2}-\d{2})/.exec(query)![1]!)
    expect(after).toBeLessThan(Date.now() - 6 * 86_400_000)
  })

  it("shows a channel's Main when its only activity in the window is a reply to an older, unfollowed root", async () => {
    const engine = await bootedEngine({
      initial: (fake) => {
        // A channel the user is in with nothing in the window but one reply, from yesterday, to a month-old root.
        fake.workspace.addConversation({
          id: 'C0ARCHITECTURE',
          name: 'architecture',
          kind: 'public',
          members: new Set([SELF_ID, 'U0LEO', 'U0MAYA']),
          created: fake.now() - 90 * DAY,
          topic: '',
          purpose: '',
          isOpen: true,
          archived: false,
        })
        seedThread(fake, { channel: 'C0ARCHITECTURE', text: 'Old proposal', ago: 30 * DAY, replies: [30 * DAY, DAY], follow: false })
        return fake.signIn()
      },
    })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === 'm:C0ARCHITECTURE'), 'the Main kept alive by the reply')
    expect(rows.find((r) => r.id === 'm:C0ARCHITECTURE')).toMatchObject({ kind: 'main', title: '#architecture' })
  })

  it('reads history over the quiet window the user chose', async () => {
    const fake = await startFakeSlack()
    const userData = join(tmpdir(), `juno-quiet-${process.pid}-${Date.now()}`)
    await mkdir(userData, { recursive: true })
    const paths = workspacePaths(userData, fake.teamId)
    await Effect.runPromise(prefs.set('quietDays', 3).pipe(Effect.provide(Store.layer(paths)), Effect.scoped))
    const credentials = fake.signIn()
    const engine = await startTestEngine({ reuse: { userData, fake, credentials }, initial: () => credentials })
    engines.push({ ...engine, stop: async () => (await engine.stop(), await fake.close(), await rm(userData, { recursive: true, force: true })) })
    await engine.phase('live', 30_000)
    const oldest = Number(apiCalls(engine, 'conversations.history')[0]!.args['oldest'])
    expect(Math.abs(oldest - (Date.now() / 1000 - 3 * 86_400))).toBeLessThan(120)
  })

  it('discovery asks search for newest first, so a long gap is read in full and not sampled', async () => {
    const first = await bootedEngine()
    await first.rowsUntil((rows) => rows.length >= 20, 'rows')
    const flags = threadId(first, 'C0PLATFORM', 'We have 142 flags')
    const posted: Array<string> = []
    const second = await restart(engines, first, (fake) => {
      for (let i = 0; i < 70; i++) posted.push(fake.injectMessage({ channel: 'C0PLATFORM', user: 'U0LEO', text: `Flag ${i} removed.`, threadTs: tsOf(flags) }).ts)
    })
    await quiet(second)
    expect(apiCalls(second, 'search.modules.messages').every((c) => c.args['sort'] === 'timestamp' && c.args['sort_dir'] === 'desc')).toBe(true)
    const stored = readDb(second, 'cache.db', (db) => db.prepare('SELECT ts FROM messages WHERE channel = ? AND thread_ts = ?').all('C0PLATFORM', tsOf(flags)) as Array<{ ts: string }>)
    const storedTs = new Set(stored.map((r) => r.ts))
    expect(posted.filter((ts) => !storedTs.has(ts))).toEqual([])
  })
})

describe('workspace events', () => {
  it('archive, unarchive, delete, leaving, closing a DM and a rename change only what they say', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const conversation = (id: string) =>
      readDb(engine, 'cache.db', (db) => db.prepare('SELECT kind, name, topic, is_member, is_archived FROM conversations WHERE id = ?').get(id)) as
        | { kind: string; name: string; topic: string | null; is_member: number; is_archived: number }
        | undefined
    const cases: ReadonlyArray<{ name: string; act: () => void; expect: () => boolean }> = [
      { name: 'archive', act: () => engine.fake.emitFrame({ type: 'channel_archive', channel: 'C0DEPLOYS', user: 'U0SAM', event_ts: eventTs() }), expect: () => conversation('C0DEPLOYS')?.is_archived === 1 },
      { name: 'unarchive', act: () => engine.fake.emitFrame({ type: 'channel_unarchive', channel: 'C0DEPLOYS', user: 'U0SAM', event_ts: eventTs() }), expect: () => conversation('C0DEPLOYS')?.is_archived === 0 },
      { name: 'delete', act: () => engine.fake.emitFrame({ type: 'channel_deleted', channel: 'C0SOCIAL', event_ts: eventTs() }), expect: () => conversation('C0SOCIAL')?.is_member === 0 },
      {
        name: 'self leaves',
        act: () => engine.fake.emitFrame({ type: 'member_left_channel', user: SELF_ID, channel: 'C0INCIDENTS', channel_type: 'C', team: engine.fake.teamId, event_ts: eventTs() }),
        expect: () => conversation('C0INCIDENTS')?.is_member === 0,
      },
      {
        name: 'im_close',
        act: () => engine.fake.emitFrame({ type: 'im_close', channel: 'D0SAM', user: SELF_ID, event_ts: eventTs() }),
        expect: () => conversation('D0SAM')?.is_member === 1,
      },
    ]
    for (const step of cases) {
      step.act()
      await waitFor(() => (step.expect() ? true : undefined), 10_000, step.name)
    }
    const rows = await engine.rowsUntil((list) => !list.some((r) => r.channel.id === 'C0SOCIAL' || r.channel.id === 'C0INCIDENTS'), 'left channels gone')
    expect(rows.some((r) => r.channel.id === 'D0SAM')).toBe(true)

    // A rename sends a partial channel object: the private channel keeps its kind and topic.
    const hiring = conversation('C0HIRING')!
    engine.fake.renameChannel({ channel: 'C0HIRING', name: 'recruiting' })
    await engine.rowsUntil((list) => list.some((r) => r.channel.label === '#recruiting'), 'the renamed channel')
    expect(conversation('C0HIRING')).toEqual({ ...hiring, name: 'recruiting' })
    expect((await engine.rows()).find((r) => r.channel.label === '#recruiting')?.channel.kind).toBe('private')
  })

  it('a mention of a user group the user belongs to counts as a mention', async () => {
    const engine = await bootedEngine({
      initial: (fake) => {
        fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
        return fake.signIn()
      },
    })
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const id = threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Heads up <!subteam^S0PLATFORM|@platform>, review please.', threadTs: tsOf(id) })
    const rows = await engine.rowsUntil((list) => list.find((r) => r.id === id)?.unreadCount === 1, 'the reply')
    expect(rows.find((r) => r.id === id)).toMatchObject({ mentionsMe: true })
  })

  it('a user the edge does not know is asked for once per session', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0GHOST', text: 'Hello from another org.' })
    await engine.rowsUntil((rows) => rows.some((r) => r.preview.text === 'Hello from another org.'), 'the message')
    const asked = () => engine.fake.calls.filter((c) => c.kind === 'edge' && JSON.stringify(c.args).includes('U0GHOST')).length
    for (let i = 0; i < 2; i++) {
      engine.fake.dropSocket()
      await engine.phase('offline')
      await engine.phase('live', 20_000)
      await quiet(engine)
    }
    expect(asked()).toBe(1)
  })

  it('keys the workspace directory by enterprise and team on Grid', async () => {
    const engine = await bootedEngine({ enterpriseId: 'E0ORG' })
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    expect(existsSync(join(engine.userData, 'workspaces', `E0ORG-${engine.fake.teamId}`, 'cache.db'))).toBe(true)
    expect(existsSync(join(engine.userData, 'workspaces', 'E0ORG'))).toBe(false)
  })
})
