// Sync end to end: the engine boots against the fake, the sidebar rows reach
// the state atoms over the port, and socket events update them live.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONVERSATIONS } from '@juno/fake-slack'
import { topicCountsAtom } from '@juno/state'
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

/** The number of conversations in the fixture with activity inside the quiet window. */
const activeConversations = CONVERSATIONS.filter((c) => {
  const newest = Math.min(...c.messages.flatMap((m) => [m.ago, ...(m.replies ?? []).map((r) => r.ago)]))
  return newest < 7 * 24 * 60
}).length

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
    const eng = byTitle('#eng')
    expect(eng).toMatchObject({ kind: 'main', tags: ['main'], unreadCount: 2, unreadExact: true, mentionsMe: false, subscribed: false })
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

    // A thread the user does not follow still shows, with a preview from its latest reply.
    const flaky = byTitle('checkout.spec failed again on main. Third…')
    expect(flaky).toMatchObject({ subscribed: false, messageCount: 5, unreadCount: 0, preview: { line: 'Dev: On it.' } })

    // Quiet topics stay out: nothing older than 7 days.
    expect(byTitle('Lag alerts are firing on the…')).toBeUndefined()
    expect(byTitle('Icon refresh is merged.')).toBeUndefined()
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    expect(rows.every((r) => r.lastActivityAt > weekAgo)).toBe(true)

    // A never-read channel shows what is stored and says the count is not exact.
    expect(byTitle('#alerts-prod')).toMatchObject({ unreadCount: 9, unreadExact: false })
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
    fake.resetCalls()

    const second = await startTestEngine({ reuse, initial: () => credentials })
    engines.push(second)
    await second.status('ready')
    await second.phase('live', 30_000)
    const rows = await second.rowsUntil(
      (list) => list.some((r) => r.preview.text === 'Pricing page copy is live.') && list.some((r) => r.preview.text === 'Still flaky after the wait?'),
      'the two new messages',
    )
    expect(rows.find((r) => r.title === '#product')).toMatchObject({ unreadCount: 1 })
    expect(rows.find((r) => r.title === 'checkout.spec failed again on main. Third…')).toMatchObject({ messageCount: 6, unreadCount: 1 })

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
