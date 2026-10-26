// Socket drops and restarts (architecture 5.8): what changes in Slack while Juno is offline or closed reaches
// the rows and the store, the catch-up reads only what moved, and a page or counts answer in flight never
// undoes a newer event. Every test starts warm on the synced default workspace.
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { type TopicRow } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { controlledSweeps } from '../controlledClock'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, DAY, notRecheck, quiet, readDb, restart, seedThread, storedFollow, threadId, tsOf, type SeededThread } from '../scenario'
import { syncedEngine, type SyncedOptions } from '../synced'

const engines: Array<RunningEngine> = []
const clocks: Array<{ readonly close: () => Promise<void> }> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const clock of clocks.splice(0)) await clock.close()
})

const synced = (options: SyncedOptions = {}) => syncedEngine(engines, options)
/** A follow pass at every catch-up, so a reconnect reads every followed thread (the app does this once an hour). */
const EVERY_CATCH_UP = { timing: { followPassMillis: 0 } }
/** A warm engine whose periodic sweeps run only when the test calls `sweep()`. */
async function sweeping(followPassMillis: number) {
  const sweeps = await controlledSweeps()
  clocks.push(sweeps)
  const engine = await synced({ clock: sweeps.clock, timing: { sweepIntervalMillis: sweeps.sweepIntervalMillis, followPassMillis } })
  return { engine, sweeps, sweep: () => sweeps.sweep(engine) }
}

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

/** Calls of a method made for a reason; `undefined` matches calls made without one. */
const callsFor = (engine: RunningEngine, method: string, reason?: string) => apiCalls(engine, method).filter((call) => call.args['_x_reason'] === reason)
const rechecks = (engine: RunningEngine) => engine.fake.calls.filter((call) => call.args['_x_reason'] === 'recheck')
/** Methods a catch-up calls once, whatever moved. */
const ONCE = ['auth.test', 'client.userBoot', 'client.counts', 'users.prefs.get', 'usergroups.list']
const expectOnceAtMost = (engine: RunningEngine) => {
  for (const method of ONCE) expect(apiCalls(engine, method).length, method).toBeLessThanOrEqual(1)
}

/** A stored message's text, whether it is a tombstone, and its reactions as `name:users`. */
function storedMessage(engine: RunningEngine, channel: string, ts: string) {
  return readDb(engine, 'cache.db', (db) => {
    const row = db.prepare('SELECT text, deleted FROM messages WHERE channel = ? AND ts = ?').get(channel, ts) as { text: string; deleted: number } | undefined
    const reactions = (db.prepare('SELECT name, user_ids_json FROM reactions WHERE channel = ? AND ts = ? ORDER BY name').all(channel, ts) as Array<{ name: string; user_ids_json: string }>).map(
      (r) => `${r.name}:${(JSON.parse(r.user_ids_json) as Array<string>).join(',')}`,
    )
    return row === undefined ? undefined : { text: row.text, deleted: row.deleted === 1, reactions }
  })
}

/** Recent messages in #eng's Main and in a thread, with a reaction, for changes made while Juno cannot hear them. */
async function seedRecent(engine: RunningEngine) {
  const { fake } = engine
  const edited = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Deploy at 3.' })
  const deleted = fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Wrong channel, sorry.' })
  const unreacted = fake.injectMessage({ channel: 'C0ENG', user: 'U0PRIYA', text: 'Release notes are up.' })
  fake.addReaction({ channel: 'C0ENG', ts: unreacted.ts, name: 'eyes', user: 'U0JONAS' })
  const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Which runner do we use?' })
  const reply = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'The big one.', threadTs: root.ts })
  await waitFor(() => (storedMessage(engine, 'C0ENG', reply.ts) === undefined ? undefined : true), undefined, 'the recent messages stored')
  await quiet(engine)
  return { edited, deleted, unreacted, root, reply }
}

/** Edits in Main and in a thread, a delete, a reaction added and the only reaction removed. */
function changeWhileAway(engine: RunningEngine, seeded: Awaited<ReturnType<typeof seedRecent>>) {
  const { fake } = engine
  fake.editMessage({ channel: 'C0ENG', ts: seeded.edited.ts, text: 'Deploy at 4.' })
  fake.addReaction({ channel: 'C0ENG', ts: seeded.edited.ts, name: 'tada', user: 'U0SAM' })
  fake.deleteMessage({ channel: 'C0ENG', ts: seeded.deleted.ts })
  fake.removeReaction({ channel: 'C0ENG', ts: seeded.unreacted.ts, name: 'eyes', user: 'U0JONAS' })
  fake.editMessage({ channel: 'C0ENG', ts: seeded.reply.ts, text: 'The small one.' })
}

/** Every change from `changeWhileAway` is in the store, and nothing else moved. */
async function expectChanges(engine: RunningEngine, seeded: Awaited<ReturnType<typeof seedRecent>>) {
  await waitFor(
    () => (storedMessage(engine, 'C0ENG', seeded.deleted.ts)?.deleted === true && storedMessage(engine, 'C0ENG', seeded.reply.ts)?.text === 'The small one.' ? true : undefined),
    undefined,
    'the changes made while away',
  )
  expect(storedMessage(engine, 'C0ENG', seeded.edited.ts)).toEqual({ text: 'Deploy at 4.', deleted: false, reactions: ['tada:U0SAM'] })
  expect(storedMessage(engine, 'C0ENG', seeded.unreacted.ts)).toEqual({ text: 'Release notes are up.', deleted: false, reactions: [] })
  expect(storedMessage(engine, 'C0ENG', seeded.root.ts)).toMatchObject({ text: 'Which runner do we use?', deleted: false })
}

// A socket drop
it('brings back what changed offline (a read, a reply, an unfollow, a Main message, a channel joined), reading only what moved', async () => {
  const engine = await synced(EVERY_CATCH_UP)
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
    fake.workspace.addConversation({ id: 'C0LAUNCH', name: 'launch', kind: 'public', members: new Set([SELF_ID, 'U0MAYA']), created: fake.now(), topic: 'Launch week', purpose: '', isOpen: true, archived: false })
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

  await quiet(engine)
  expectOnceAtMost(engine)
  // History only for the conversations whose latest moved; the read alone costs none.
  expect(new Set(apiCalls(engine, 'conversations.history').filter(notRecheck).map((c) => c.args['channel']))).toEqual(new Set(['C0PRODUCT', 'C0LAUNCH']))
  // The root of the one stored follow the getView list left out, and no other.
  expect(callsFor(engine, 'conversations.replies', 'root').map((c) => c.args['ts'])).toEqual([tsOf(finance)])
  expect(rechecks(engine).length).toBeLessThanOrEqual(10)
})

it('brings edits, deletes and reactions made during a drop, in Main and in a thread, with one recheck page per recent topic', async () => {
  const engine = await synced()
  const seeded = await seedRecent(engine)
  await offline(engine, () => changeWhileAway(engine, seeded))
  await expectChanges(engine, seeded)
  // One page for each recently active topic, at most ten: #eng's Main and the new thread among them.
  const pages = rechecks(engine)
  expect(pages.length).toBeLessThanOrEqual(10)
  expect(pages.some((c) => c.method === 'conversations.history' && c.args['channel'] === 'C0ENG')).toBe(true)
  expect(pages.some((c) => c.method === 'conversations.replies' && c.args['ts'] === seeded.root.ts)).toBe(true)
})

it('reads followed threads past the first getView page', async () => {
  const first = await synced()
  const threads: Array<SeededThread> = []
  const engine = await restart(engines, first, (fake) => {
    for (let i = 0; i < 15; i++) threads.push(seedThread(fake, { channel: 'C0PLATFORM', text: `Migration ${i + 1}`, ago: 3 * DAY, replies: [2 * DAY + i * 60_000], follow: true }))
  }, EVERY_CATCH_UP)
  await engine.rowsUntil((rows) => threads.every((t) => rows.some((r) => r.id === t.id)), 'the seeded threads')
  // Read everywhere but here while offline: Slack moves the read pointers and Juno sees no event.
  await offline(engine, () => {
    for (const t of threads) engine.fake.markThreadRead({ channel: t.channel, threadTs: t.ts, ts: engine.fake.workspace.replies(t.channel, t.ts as never).at(-1)!.ts, read: false })
  })
  await engine.rowsUntil((list) => threads.every((t) => list.find((r) => r.id === t.id)?.unreadCount === 1), 'every thread unread again')
  // 27 follows are three pages; each page is read once per pass.
  const pages = apiCalls(engine, 'subscriptions.thread.getView').length
  expect(pages).toBeGreaterThanOrEqual(3)
  expect(pages).toBeLessThanOrEqual(6)
})

it('stops counting an unfollowed thread as exact after a drop the sweep could not fill', async () => {
  const engine = await synced()
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

it('the discovery sweep keeps the files and blocks of a stored reply', async () => {
  const engine = await synced()
  const id = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc.')
  const file = { id: 'F0PLAN', name: 'plan.pdf', title: 'plan.pdf', mimetype: 'application/pdf', filetype: 'pdf', size: 1024 }
  const posted = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Here is the plan.', threadTs: tsOf(id) as never, files: [file] })
  await engine.rowsUntil((rows) => rows.find((r) => r.id === id)?.preview.text === 'Here is the plan.', 'the reply')
  const stored = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT files_json, blocks_json FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', posted.ts)) as { files_json: string | null; blocks_json: string | null }
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

// Pages and answers in flight never undo newer events
it('a channel_marked that lands while client.counts is in flight is not undone by the older answer', async () => {
  const engine = await synced()
  expect((await engine.rows()).find((r) => r.title === '#eng')?.unreadCount).toBeGreaterThan(0)
  engine.fake.holdNext({ method: 'client.counts' })
  engine.fake.dropSocket()
  await waitFor(() => (engine.fake.heldCount({ method: 'client.counts' }) === 1 ? true : undefined), 20_000, 'the held counts')
  engine.fake.markRead({ channel: 'C0ENG', ts: engine.fake.workspace.main('C0ENG').at(-1)!.ts })
  await engine.rowsUntil((rows) => rows.find((r) => r.title === '#eng')?.unreadCount === 0, 'eng read')
  // The held answer was made before the mark, so it carries the old pointer.
  engine.fake.release()
  await engine.phase('live', 20_000)
  await quiet(engine)
  expect((await engine.rows()).find((r) => r.title === '#eng')?.unreadCount).toBe(0)
})

it('does not delete a message posted after the recheck asked, whose event came first', async () => {
  const engine = await synced()
  await seedRecent(engine)
  engine.fake.goOffline()
  await engine.phase('offline')
  engine.fake.holdNext({ method: 'conversations.history', reason: 'recheck' })
  engine.fake.goOnline()
  // The recheck's first Main page, #eng's, has left; a message posted now is stored by its event before the page lands.
  const [held] = await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? engine.fake.heldCalls({ method: 'conversations.history' }) : undefined), 30_000, 'the held recheck page')
  expect(held!['channel']).toBe('C0ENG')
  const late = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Posted during the recheck.' })
  await waitFor(() => (storedMessage(engine, 'C0ENG', late.ts) === undefined ? undefined : true), undefined, 'the late message stored')
  engine.fake.release()
  await engine.phase('live', 30_000)
  await quiet(engine)
  expect(storedMessage(engine, 'C0ENG', late.ts)).toMatchObject({ text: 'Posted during the recheck.', deleted: false })
})

// A restart
it('brings edits, deletes and reactions made while the app was closed', async () => {
  const first = await synced()
  const seeded = await seedRecent(first)
  const engine = await restart(engines, first, () => changeWhileAway(first, seeded))
  await expectChanges(engine, seeded)
})

it('a damaged cache found at the next start is synced again, still signed in', async () => {
  const first = await synced()
  const engine = await restart(engines, first, () => {
    writeFileSync(join(first.userData, 'workspaces', first.fake.teamId, 'cache.db'), 'not a database '.repeat(400))
  })
  expect((await engine.status('ready'))._tag).toBe('ready')
  await engine.rowsUntil((rows) => rows.some((row) => row.title.startsWith('Draft plan is in the doc')), 'the rows synced again')
})

it('reads only what moved while closed: a new Main message, and a reply whose root is older than the search reaches', async () => {
  const first = await synced()
  const threadText = 'An older unfollowed thread.'
  let oldRoot: SeededThread | undefined
  const engine = await restart(engines, first, (fake) => {
    // Keep the root outside discovery's date window at every time of day.
    oldRoot = seedThread(fake, { channel: 'C0ENG', text: threadText, ago: 2 * DAY, replies: [1, 2, 3, 4, 5].map((minutes) => 2 * DAY - minutes * 60_000), follow: false })
    fake.injectMessage({ channel: 'C0PRODUCT', user: 'U0PRIYA', text: 'Pricing page copy is live.' })
    fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Still flaky after the wait?', threadTs: oldRoot.ts })
    // A reply in a public channel the user is not in: search returns it, the sync must drop it.
    const salesRoot = fake.messages('C0SALES').find((m) => (m.reply_count ?? 0) > 0)!
    fake.injectMessage({ channel: 'C0SALES', user: 'U0MAYA', text: 'Forecast is in the deck.', threadTs: salesRoot.ts })
  })
  const rows = await engine.rowsUntil((list) => list.some((r) => r.preview.text === 'Pricing page copy is live.'), 'the new Main message')
  expect(rows.find((r) => r.title === '#product')).toMatchObject({ unreadCount: 1 })
  expect(rows.find((r) => r.channel.id === 'C0SALES')).toBeUndefined()
  // The reply in the unfollowed thread was discovered and indexed with Slack's reply count (the root and six replies), but it is not a sidebar row.
  const id = oldRoot!.id
  expect(rows.find((r) => r.id === id)).toBeUndefined()
  await quiet(engine)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT message_count FROM topic_index WHERE topic_id = ?').get(id))).toEqual({ message_count: 7 })

  expectOnceAtMost(engine)
  // History only for the conversation whose latest moved; the thread reply came from the discovery search.
  expect(apiCalls(engine, 'conversations.history').filter(notRecheck).map((c) => c.args['channel'])).toEqual(['C0PRODUCT'])
  // Search found the reply but not its old root: one lookup for the root's reply count.
  expect(apiCalls(engine, 'conversations.replies').filter(notRecheck).map((call) => [call.args['ts'], call.args['_x_reason']])).toEqual([[oldRoot!.ts, 'root']])
  expect(rechecks(engine).length).toBeLessThanOrEqual(10)
})

it('uses the root metadata on a search page, without a per-thread lookup (review M3 finding 3)', async () => {
  const first = await synced()
  let root: { ts: string } | undefined
  let reply: { ts: string } | undefined
  const engine = await restart(engines, first, (fake) => {
    root = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Search-only root' })
    reply = fake.workspace.post({ channel: 'C0ENG', user: 'U0SAM', text: 'Search-only reply', threadTs: root.ts as never })
    // The history page is unavailable; discovery must establish this thread.
    fake.forceError({ method: 'conversations.history', error: 'not_allowed' })
  }, { recheckTopics: 0 })
  await quiet(engine)
  expect(apiCalls(engine, 'search.modules.messages').every((c) => c.args['extra_message_data'] === '1')).toBe(true)
  expect(callsFor(engine, 'conversations.replies', 'root').filter((c) => c.args['ts'] === root!.ts)).toHaveLength(0)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, reply_count, latest_reply FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', root!.ts))).toMatchObject({ text: 'Search-only root', reply_count: 1, latest_reply: reply!.ts })
  expect(storedMessage(engine, 'C0ENG', reply!.ts)).toMatchObject({ text: 'Search-only reply' })
})

it('asks search newest first, so a long gap is read in full and not sampled', async () => {
  const first = await synced()
  const flags = threadId(first.fake, 'C0PLATFORM', 'We have 142 flags')
  const posted: Array<string> = []
  const engine = await restart(engines, first, (fake) => {
    for (let i = 0; i < 70; i++) posted.push(fake.injectMessage({ channel: 'C0PLATFORM', user: 'U0LEO', text: `Flag ${i} removed.`, threadTs: tsOf(flags) }).ts)
  })
  await quiet(engine)
  expect(apiCalls(engine, 'search.modules.messages').every((c) => c.args['sort'] === 'timestamp' && c.args['sort_dir'] === 'desc' && c.args['extra_message_data'] === '1')).toBe(true)
  const stored = new Set(readDb(engine, 'cache.db', (db) => db.prepare('SELECT ts FROM messages WHERE channel = ? AND thread_ts = ?').all('C0PLATFORM', tsOf(flags)) as Array<{ ts: string }>).map((r) => r.ts))
  expect(posted.filter((ts) => !stored.has(ts))).toEqual([])
})

// Periodic sweeps
it('discovery finds a late-indexed reply older than the previous sweep cursor', async () => {
  const { engine, sweep } = await sweeping(60 * 60_000)
  const root = seedThread(engine.fake, { channel: 'C0ENG', text: 'An unfollowed thread for delayed search indexing.', ago: 2 * DAY, replies: [], follow: false })
  await sweep()
  const late = engine.fake.workspace.post({ channel: 'C0ENG', threadTs: root.ts as never, user: 'U0MAYA', text: 'Indexed after the cursor moved', at: engine.fake.now() - 30_000, silent: true })
  await sweep()
  // Slack's getView does not list this unfollowed thread; only discovery can find the retro-timestamped reply.
  await waitFor(() => (storedMessage(engine, 'C0ENG', late.ts)?.text === 'Indexed after the cursor moved' ? true : undefined), undefined, 'the late reply stored')
})

it('the thread view sweep leaves an unchanged cache alone and repairs a missed reply', async () => {
  const { engine, sweep } = await sweeping(0)
  const rootTs = tsOf(threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc.'))
  const cache = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'), { readOnly: true })
  try {
    const dataVersion = () => (cache.prepare('PRAGMA data_version').get() as { data_version: number }).data_version
    await sweep()
    const before = dataVersion()
    engine.fake.resetCalls()
    await sweep()
    expect(apiCalls(engine, 'subscriptions.thread.getView').length).toBeGreaterThan(0)
    expect(dataVersion()).toBe(before)
    const missed = engine.fake.workspace.post({ channel: 'C0ENG', threadTs: rootTs as never, user: 'U0MAYA', text: 'The silent canary reply', silent: true })
    await sweep()
    expect(storedMessage(engine, 'C0ENG', missed.ts)).toMatchObject({ text: 'The silent canary reply' })
  } finally {
    cache.close()
  }
})

it('the thread view sweep keeps the repairs from pages it fetched when a later page fails', async () => {
  const { engine, sweep } = await sweeping(0)
  const target = [...engine.fake.workspace.subscriptions.values()]
    .filter((subscription) => subscription.subscribed && engine.fake.workspace.replies(subscription.channel, subscription.threadTs).length > 1)
    .toSorted((a, b) => {
      const activity = (subscription: typeof a) => engine.fake.workspace.find(subscription.channel, subscription.threadTs)?.latest_reply ?? subscription.threadTs
      return activity(b).localeCompare(activity(a))
    })[0]!
  const replies = engine.fake.workspace.replies(target.channel, target.threadTs)
  const id = `t:${target.channel}:${target.threadTs}`
  // Marked unread from its last reply on another device, with the event lost.
  engine.fake.holdFrames({ types: ['thread_marked'] })
  engine.fake.markThreadRead({ channel: target.channel, threadTs: target.threadTs, ts: replies.at(-1)!.ts, read: false })
  engine.fake.releaseFrames({ drop: true })
  engine.fake.gate((method, args) => method === 'subscriptions.thread.getView' && args['current_ts'] !== undefined)
  const swept = sweep()
  const before = await waitFor(() => engine.fake.gated().find((call) => call.stage === 'before'), undefined, 'the later getView page')
  engine.fake.decide(before.id, { error: 'internal_error' })
  const answer = await waitFor(() => engine.fake.gated().find((call) => call.id === before.id && call.stage === 'answer'), undefined, 'the failed getView answer')
  engine.fake.decide(answer.id, 'answer')
  engine.fake.gate()
  await swept
  const row = (await engine.rowsUntil((rows) => rows.some((r) => r.id === id && r.unreadCount === 1), 'the thread unread from its last reply')).find((r) => r.id === id)
  expect(row).toMatchObject({ unreadCount: 1 } satisfies Partial<TopicRow>)
})
