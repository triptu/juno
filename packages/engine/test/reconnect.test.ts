// The catch-up after a socket drop (architecture 5.8): what changed while
// Juno was offline reaches the sidebar with a fixed call budget, and pages in
// flight while events land never undo the events.
import { afterEach, describe, expect, it } from 'vitest'
import { SELF_ID } from '@juno/fake-slack'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, callMap, DAY, quiet, readDb, seedThread, storedFollow, threadId, tsOf, type SeededThread } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** Drops the socket and keeps it down while `whileOffline` runs, then waits for the catch-up to finish. */
async function offline(engine: RunningEngine, whileOffline: () => void): Promise<void> {
  engine.fake.goOffline()
  await engine.phase('offline')
  whileOffline()
  engine.fake.resetCalls()
  engine.fake.goOnline()
  await engine.phase('live', 30_000)
  await engine.syncIdle()
}

describe('reconnect', () => {
  it('brings back what changed offline: a read, a reply, an unfollow, a Main message and a channel joined', async () => {
    const engine = await bootedEngine(engines)
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    await quiet(engine)
    const draft = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc.')
    const finance = threadId(engine.fake, 'C0LEADERSHIP', 'Finance wants the 2027 plan')
    expect((await engine.rows()).some((r) => r.id === finance)).toBe(true)

    await offline(engine, () => {
      const { fake } = engine
      fake.markRead({ channel: 'C0ENG', ts: fake.workspace.main('C0ENG').at(-1)!.ts })
      fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Dry run is green.', threadTs: tsOf(draft) })
      fake.unfollowThread({ channel: 'C0LEADERSHIP', threadTs: tsOf(finance) })
      fake.injectMessage({ channel: 'C0PRODUCT', user: 'U0PRIYA', text: 'Pricing page copy is live.' })
      // A channel created and joined elsewhere: the store has never seen it.
      fake.workspace.addConversation({
        id: 'C0LAUNCH',
        name: 'launch',
        kind: 'public',
        members: new Set([SELF_ID, 'U0MAYA']),
        created: fake.now(),
        topic: 'Launch week',
        purpose: '',
        isOpen: true,
        archived: false,
      })
      fake.injectMessage({ channel: 'C0LAUNCH', user: 'U0MAYA', text: 'Welcome to launch week.' })
    })

    const rows = await engine.rowsUntil(
      (list) =>
        list.find((r) => r.title === '#eng')?.unreadCount === 0 &&
        list.find((r) => r.id === draft)?.preview.text === 'Dry run is green.' &&
        !list.some((r) => r.id === finance) &&
        list.some((r) => r.preview.text === 'Pricing page copy is live.') &&
        list.some((r) => r.id === 'm:C0LAUNCH'),
      'every offline change',
    )
    expect(rows.find((r) => r.id === draft)).toMatchObject({ unreadCount: 1, unreadExact: true })
    expect(rows.find((r) => r.id === 'm:C0LAUNCH')).toMatchObject({ title: '#launch', unreadCount: 1 })
    expect(storedFollow(engine, 'C0LEADERSHIP', tsOf(finance))).toBe(0)

    // The budget: the socket's URL is left out (its count depends on the backoff), everything else is exact.
    const { 'api:client.getWebSocketURL': _socket, ...budget } = callMap(engine)
    expect(budget).toEqual({
      'api:client.counts': 1,
      // The joined channel, which counts listed and the store did not know.
      'api:conversations.info': 1,
      // The two conversations whose latest moved.
      'api:conversations.history': 2,
      // One page back to the last sync (its last thread is older), then the complete pass of two pages.
      'api:subscriptions.thread.getView': 3,
      // The root of the one stored follow the list left out.
      'api:conversations.replies': 1,
      'api:search.modules.messages': 1,
    })
    expect(apiCalls(engine, 'conversations.replies')[0]!.args['ts']).toBe(tsOf(finance))
  })

  it('reads followed threads past the first getView page', async () => {
    const threads: Array<SeededThread> = []
    const engine = await bootedEngine(engines, {
      initial: (fake) => {
        for (let i = 0; i < 15; i++) threads.push(seedThread(fake, { channel: 'C0PLATFORM', text: `Migration ${i + 1}`, ago: 3 * DAY, replies: [2 * DAY + i * 60_000], follow: true }))
        return fake.signIn()
      },
    })
    await engine.rowsUntil((rows) => threads.every((t) => rows.some((r) => r.id === t.id)), 'the seeded threads')
    // Read everywhere but here while offline: Slack moves the read pointers and Juno sees no event.
    await offline(engine, () => {
      for (const t of threads) engine.fake.markThreadRead({ channel: t.channel, threadTs: t.ts, ts: engine.fake.workspace.replies(t.channel, t.ts as never).at(-1)!.ts, read: false })
    })
    const rows = await engine.rowsUntil((list) => threads.every((t) => list.find((r) => r.id === t.id)?.unreadCount === 1), 'every thread unread again')
    expect(rows.filter((r) => threads.some((t) => t.id === r.id))).toHaveLength(15)
    // One page back to the last sync, then the complete pass: 27 followed threads, three pages.
    expect(apiCalls(engine, 'subscriptions.thread.getView')).toHaveLength(4)
  })

  it('a channel_marked that lands while client.counts is in flight is not undone by the older answer', async () => {
    const engine = await bootedEngine(engines)
    const before = await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    expect(before.find((r) => r.title === '#eng')?.unreadCount).toBe(2)
    engine.fake.holdNext({ method: 'client.counts' })
    engine.fake.dropSocket()
    await waitFor(() => (engine.fake.heldCount({ method: 'client.counts' }) === 1 ? true : undefined), 20_000, 'the held counts')
    const latest = engine.fake.workspace.main('C0ENG').at(-1)!.ts
    engine.fake.markRead({ channel: 'C0ENG', ts: latest })
    await engine.rowsUntil((rows) => rows.find((r) => r.title === '#eng')?.unreadCount === 0, 'eng read')
    // The held answer was made before the mark, so it carries the old pointer.
    engine.fake.release()
    await engine.phase('live', 20_000)
    await quiet(engine)
    expect((await engine.rows()).find((r) => r.title === '#eng')?.unreadCount).toBe(0)
    const read = readDb(engine, 'user.db', (db) => db.prepare('SELECT last_read_ts FROM topic_reads WHERE topic_id = ?').get('m:C0ENG')) as { last_read_ts: string }
    expect(read.last_read_ts).toBe(latest)
  })

  it('stops counting an unfollowed thread as exact after a drop the sweep could not fill', async () => {
    const engine = await bootedEngine(engines)
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const flaky = threadId(engine.fake, 'C0ENG', 'checkout.spec')
    await offline(engine, () => {
      // A reply during the drop, and a sweep that fails: the store never learns of it.
      engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Failed again overnight.', threadTs: tsOf(flaky) })
      engine.fake.forceError({ method: 'search.modules.messages', error: 'not_allowed' })
    })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0JONAS', text: '<@U0TUSHAR> can you check the runner?', threadTs: tsOf(flaky) })
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === flaky), 'the mentioned thread')
    // Two replies are unread in Slack and one is stored: the row says "at least one", not an exact count.
    expect(rows.find((r) => r.id === flaky)).toMatchObject({ mentionsMe: true, unreadExact: false })
  })

  it('events that land while a cold-boot history page is in flight survive the page', async () => {
    const engine = await startTestEngine({
      initial: (fake) => {
        fake.holdNext({ method: 'conversations.history' })
        return fake.signIn()
      },
    })
    engines.push(engine)
    await engine.status('ready')
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the held page')
    const { fake } = engine
    // The page was taken before these events; it lands after them.
    const channel = String(fake.heldCalls({ method: 'conversations.history' })[0]!['channel'])
    const main = fake.workspace.main(channel)
    const edited = main.at(-1)!
    const reacted = main.at(-2) ?? edited
    fake.editMessage({ channel, ts: edited.ts, text: 'Edited while the page was in flight.' })
    fake.addReaction({ channel, ts: reacted.ts, name: 'eyes', user: 'U0JONAS' })
    const posted = fake.injectMessage({ channel, user: 'U0JONAS', text: 'Posted while the page was in flight.' })
    await waitFor(
      () => (readDb(engine, 'cache.db', (db) => db.prepare('SELECT ts FROM messages WHERE channel = ? AND ts = ?').get(channel, posted.ts)) === undefined ? undefined : true),
      10_000,
      'the posted message stored',
    )
    fake.release()
    await engine.phase('live', 30_000)
    await quiet(engine)

    const message = (ts: string) =>
      readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, edited_ts FROM messages WHERE channel = ? AND ts = ?').get(channel, ts)) as { text: string; edited_ts: string | null }
    expect(message(edited.ts)).toEqual({ text: 'Edited while the page was in flight.', edited_ts: fake.workspace.find(channel, edited.ts)!.edited!.ts })
    expect(message(posted.ts).text).toBe('Posted while the page was in flight.')
    const reactions = readDb(engine, 'cache.db', (db) => db.prepare('SELECT user_ids_json FROM reactions WHERE channel = ? AND ts = ? AND name = ?').get(channel, reacted.ts, 'eyes')) as
      | { user_ids_json: string }
      | undefined
    expect(JSON.parse(reactions?.user_ids_json ?? '[]')).toContain('U0JONAS')
  })
})
