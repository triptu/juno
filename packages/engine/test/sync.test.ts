// Sync end to end: the engine boots against the fake, the sidebar rows reach
// the state atoms over the port, and socket events update them live.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Cause, Exit, Option } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { topicsSubscribe, topicsUnsubscribe, type UndoCommand } from '@juno/contract'
import { CONVERSATIONS, SELF_ID } from '@juno/fake-slack'
import { runCommand, topicCountsAtom } from '@juno/state'
import { sleep, startTestEngine, waitFor, type RunningEngine } from './harness'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

async function bootedEngine(options: Parameters<typeof startTestEngine>[0] = {}) {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn(), ...options })
  engines.push(engine)
  await engine.status('ready')
  await engine.phase('live', 30_000)
  return engine
}

const apiCalls = (engine: RunningEngine, method?: string) =>
  engine.fake.calls.filter((c) => c.kind === 'api' && (method === undefined || c.method === method))

/** The quiet window, in the fixture's unit (minutes before now). */
const WINDOW = 7 * 24 * 60

/** The fixture conversations the self user is in, and those with activity inside the quiet window. */
const memberConversations = CONVERSATIONS.filter((c) => c.members.includes(SELF_ID))
const nonMemberChannels = CONVERSATIONS.filter((c) => !c.members.includes(SELF_ID)).map((c) => c.id)
const activeConversations = memberConversations.filter((c) => {
  const newest = Math.min(...c.messages.flatMap((m) => [m.ago, ...(m.replies ?? []).map((r) => r.ago)]))
  return newest < WINDOW
}).length

/** The topic id of a thread in the fake, by the start of its root's text. */
const threadId = (engine: RunningEngine, channel: string, prefix: string) =>
  `t:${channel}:${engine.fake.messages(channel).find((m) => m.text?.startsWith(prefix))!.ts}`

const subscribe = (engine: RunningEngine, id: string) => runCommand(engine.registry, topicsSubscribe, { id })
const unsubscribe = (engine: RunningEngine, id: string) => runCommand(engine.registry, topicsUnsubscribe, { id })
/** Replays an undo the way the renderer's undo stack does: the command its tag names. */
const replay = (engine: RunningEngine, undo: UndoCommand) => (undo._tag === 'topics.subscribe' ? subscribe(engine, undo.id) : unsubscribe(engine, undo.id))
const valueOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`command failed: ${Cause.pretty(exit.cause)}`)
}
const errorOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined => (Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined)

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
      preview: { sender: 'Dev', text: 'Booked 2–4pm. Will post results here.', line: 'Dev: Booked 2–4pm. Will post results here.' },
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
    expect(eng?.preview.line).toBe('Dev: @Leo I think the preview environments never shut down. Will check.')
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

  it('spends one history call per active conversation and no more', async () => {
    const engine = await bootedEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const history = apiCalls(engine, 'conversations.history')
    expect(history.length).toBeLessThanOrEqual(activeConversations)
    expect(new Set(history.map((c) => c.args['channel'])).size).toBe(history.length)
    expect(apiCalls(engine, 'client.userBoot')).toHaveLength(1)
    expect(apiCalls(engine, 'client.counts')).toHaveLength(1)
    expect(apiCalls(engine, 'subscriptions.thread.getView')).toHaveLength(1)
    expect(engine.fake.calls.filter((c) => c.kind === 'edge')).toHaveLength(1)
    // The store is the source of the rows: no call is made per row.
    expect(apiCalls(engine).length).toBeLessThan(activeConversations + 10)
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
    const history = apiCalls(second, 'conversations.history')
    expect(history.map((c) => c.args['channel'])).toEqual(['C0PRODUCT'])
    expect(apiCalls(second, 'client.userBoot')).toHaveLength(1)
    expect(apiCalls(second, 'client.counts')).toHaveLength(1)
    expect(apiCalls(second, 'subscriptions.thread.getView')).toHaveLength(1)
    expect(apiCalls(second, 'search.modules.messages')).toHaveLength(1)
    expect(apiCalls(second).length).toBeLessThanOrEqual(10)
    expect(apiCalls(second, 'users.prefs.get')).toHaveLength(0)

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
      preview: { line: 'Leo: Dry run passed. @Tushar we are good for Thursday.' },
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
    expect(after.find((r) => r.id === pricing.id)).toMatchObject({ tags: ['reopened'], resolved: false, preview: { line: 'Maya: Legal signed off.' } })
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
    expect(rows.find((r) => r.title === 'Sam')?.preview.line).toBe('Sam: Notes from today: promo packet for Dev, on-call load, Q1 planning.')
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
    expect(rows.find((r) => r.id === id)).toMatchObject({ subscribed: true, messageCount: 7, tags: [], preview: { line: 'You: Yes, until Friday.' } })
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
