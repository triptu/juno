// The first sync, from sign-in to live (SPEC 5, architecture 5.8): the list is usable before any
// history, every row is named when it first shows, history is read in the order the user needs it,
// conversations the user is not in cost nothing, and a boot that fails part way picks up where it
// stopped. Each test is a cold boot on a fresh fake; that is what it tests.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { viewsDelete, type TopicRow } from '@juno/contract'
import { CONVERSATIONS, largeSeed, SELF_ID } from '@juno/fake-slack'
import { homeViewAtom, runCommand, topicCountsAtom } from '@juno/state'
import { productionTiming } from '../../src/config'
import { controlledSleep } from '../controlledClock'
import { startTestEngine, waitFor, WAIT_MS, type EngineOptions, type RunningEngine } from '../harness'
import { apiCalls, bootedEngine, DAY, quiet, readDb, seedThread, threadId, tsOf, valueOf, type SeededThread } from '../scenario'
import { step } from '../step'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const booted = (options: EngineOptions = {}, liveMillis?: number) => bootedEngine(engines, options, liveMillis)
/** Starts an engine and returns once it is signed in, before the first sync ends. */
async function started(options: EngineOptions): Promise<RunningEngine> {
  const engine = await startTestEngine(options)
  engines.push(engine)
  await engine.status('ready')
  return engine
}

/** The quiet window, in the fixture's unit (minutes before now). */
const WINDOW = 7 * 24 * 60
const memberConversations = CONVERSATIONS.filter((c) => c.members.includes(SELF_ID))
const nonMemberChannels = CONVERSATIONS.filter((c) => !c.members.includes(SELF_ID)).map((c) => c.id)
/** Member conversations with a Main message (not just a reply) inside the window: the ones the first sync reads history for. */
const activeMains = memberConversations.filter((c) => c.messages.some((m) => m.ago < WINDOW)).length

/** Every name a row shows: title, preview, place, partner and participants. */
const namesShown = (row: TopicRow): ReadonlyArray<string> => [
  row.title,
  row.preview.sender,
  row.preview.text,
  row.channel.name,
  row.channel.label,
  ...(row.channel.partner === undefined ? [] : [row.channel.partner.name]),
  ...row.participants.map((person) => person.name),
]
/** A raw user id, or the placeholder shown until a name arrives. */
const UNNAMED = /\bU0[A-Z0-9]+\b|\bSomeone\b/
const unnamed = (rows: ReadonlyArray<TopicRow>) => rows.flatMap((row) => namesShown(row).filter((text) => UNNAMED.test(text)).map((text) => `${row.id}: ${text}`))


/** Each filter shows its rows, and the sidebar's dots count the unread ones. */
async function expectFiltersAndCounts(engine: RunningEngine): Promise<void> {
  const all = await engine.rows()
  const dms = await engine.rows({ kind: 'dms', unreadOnly: false })
  expect(dms.length).toBeGreaterThan(0)
  expect(dms.every((r) => r.channel.kind === 'im' || r.channel.kind === 'mpim')).toBe(true)
  expect((await engine.rows({ kind: 'channels', unreadOnly: false })).length + dms.length).toBe(all.length)
  expect((await engine.rows({ kind: 'all', unreadOnly: true })).length).toBe(all.filter((r) => r.unreadCount > 0).length)
  const scoped = await engine.rows({ kind: 'all', unreadOnly: false, scope: 'C0ENG' })
  expect(scoped.map((r) => r.id).toSorted()).toEqual(all.filter((r) => r.channel.id === 'C0ENG').map((r) => r.id).toSorted())
  const unmount = engine.registry.mount(topicCountsAtom())
  try {
    const counts = await waitFor(() => {
      const result = engine.registry.get(topicCountsAtom())
      return result._tag === 'Success' ? result.value : undefined
    })
    const isDm = (r: TopicRow) => r.channel.kind === 'im' || r.channel.kind === 'mpim'
    expect(counts.channelsUnread).toBe(all.filter((r) => r.unreadCount > 0 && !isDm(r)).length)
    expect(counts.dmsUnread).toBe(all.filter((r) => r.unreadCount > 0 && isDm(r)).length)
  } finally {
    unmount()
  }
}

// A first sign-in
it('shows the rows of SPEC 5 for the fixture workspace, reads only member conversations, once each, and filters and counts them', async () => {
  const engine = await booted()
  const rows = await engine.rowsUntil((list) => list.length >= 20 && list.every((r) => r.preview.sender !== '' || r.channel.kind === 'im'), 'all rows named')

  await step('spends bounded calls: one history call per active Main, every getView page, never a call per row', async () => {
    await quiet(engine)
    const history = apiCalls(engine, 'conversations.history')
    expect(new Set(history.map((c) => c.args['channel'])).size).toBe(history.length)
    // A conversation whose only recent activity is a reply under an older root has nothing for history in the window.
    expect(history.length).toBe(activeMains)
    for (const id of nonMemberChannels) expect(history.map((c) => c.args['channel'])).not.toContain(id)
    for (const method of ['auth.test', 'client.userBoot', 'client.counts', 'users.prefs.get', 'usergroups.list']) expect(apiCalls(engine, method), method).toHaveLength(1)
    // The fixture follows 12 threads; Slack pages them 10 at a time: back to the window, then the complete pass.
    expect(apiCalls(engine, 'subscriptions.thread.getView').length).toBeLessThanOrEqual(4)
    // The preview search after the quick start, then discovery over the window: two pages each at most.
    expect(apiCalls(engine, 'search.modules.messages').length).toBeLessThanOrEqual(4)
    // Each person is asked for once, on the page they first appear on.
    const asked = engine.fake.calls.filter((c) => c.method === 'users/info').flatMap((c) => JSON.parse(c.args['ids'] ?? '[]') as Array<string>)
    expect(new Set(asked).size).toBe(asked.length)
    expect(engine.fake.calls.filter((c) => c.method === 'users/info').length).toBeLessThan(rows.length / 4)
  })

  await step('shows active Main rows and followed threads, newest first; no unfollowed thread, nothing quiet, no non-member channel', async () => {
    const expected = new Set<string>()
    for (const c of memberConversations) {
      const rootTs = (text: string) => engine.fake.messages(c.id).find((m) => m.text === text)!.ts
      // Main: activity of any kind inside the window, replies in its threads included, or unread.
      const active = c.messages.some((m) => m.ago < WINDOW || (m.replies ?? []).some((r) => r.ago < WINDOW))
      if (active || (c.unread ?? 0) > 0) expected.add(`m:${c.id}`)
      // Threads: only followed ones, inside the window or unread. An unfollowed thread starts read, so a mention in it before the first sign-in does not bring it in.
      for (const m of c.messages) {
        if (m.replies === undefined || m.replies.length === 0 || m.thread?.subscribed === false) continue
        if (m.replies.some((r) => r.ago < WINDOW) || (m.thread?.unread ?? 0) > 0) expected.add(`t:${c.id}:${rootTs(m.text)}`)
      }
    }
    // Automated keeps the bot channels out of All after the first sync; the rule above is about All without views.
    valueOf(await runCommand(engine.registry, viewsDelete, { id: 'automated' }))
    const all = await engine.rowsUntil((list) => list.length === expected.size, 'every row of the rule')
    expect(new Set(all.map((r) => r.id))).toEqual(expected)
    const order = all.map((r) => r.lastActivityTs)
    expect(order.toSorted().toReversed()).toEqual(order)
    expect(all.every((r) => r.kind === 'main' || r.subscribed)).toBe(true)
  })

  await step('names places and people, marks mentions, and counts unread exactly from the read pointers', async () => {
    const all = await engine.rows()
    const byTitle = (title: string) => all.find((r) => r.title === title)
    expect(byTitle('#eng')).toMatchObject({ kind: 'main', tags: ['main'], unreadCount: 2, unreadExact: true, subscribed: false, channel: { kind: 'public', label: '#eng' } })
    // Mentions read as names.
    expect(byTitle('#eng')?.preview.text).toBe('@Leo I think the preview environments never shut down. Will check.')
    expect(byTitle('Rina finished the onsite. Panel notes…')).toMatchObject({ channel: { kind: 'private', label: '#hiring' }, unreadCount: 2, mentionsMe: true })
    expect(byTitle('Maya')).toMatchObject({ kind: 'main', channel: { kind: 'im', label: 'Maya', partner: { name: 'Maya' } } })
    expect(byTitle('Maya, Leo')).toMatchObject({ channel: { kind: 'mpim' } })
    // A followed thread in a channel whose Main went quiet: both show.
    expect(byTitle('Finance wants the 2027 plan by…')).toMatchObject({ kind: 'thread', unreadCount: 1, mentionsMe: true })
    expect(byTitle('#leadership')).toMatchObject({ kind: 'main', unreadCount: 0 })
    // A never-read channel: the history page reached back to its read pointer, so the count is exact.
    expect(byTitle('#alerts-prod')).toMatchObject({ unreadCount: 9, unreadExact: true })
    expect(unnamed(all)).toEqual([])
  })

  await step('filters by kind, unread and scope, and the dots count the unread rows', () => expectFiltersAndCounts(engine))
})

it('is usable after the quick steps, before any history, and fills in without a reload', async () => {
  const time = await controlledSleep(productionTiming.automatedHoldMillis)
  try {
    // Every history answer and every search (the preview search, then discovery) wait: the boot cannot get past its quick steps on its own.
    const engine = await started({
      clock: time.clock,
      timing: { automatedHoldMillis: productionTiming.automatedHoldMillis },
      initial: (fake) => {
        fake.holdNext({ method: 'conversations.history', times: 100 })
        fake.holdNext({ method: 'search.modules.messages', times: 10 })
        return fake.signIn()
      },
    })
    // The quick start is stored: the renderer shows the list from here on.
    const window = await waitFor(() => {
      const result = engine.registry.get(engine.topicsAtom())
      return result._tag === 'Success' && result.value.meta.windowCovered === true ? result.value : undefined
    }, undefined, 'the quick start')
    expect(apiCalls(engine, 'conversations.history').filter((c) => c.ok)).toHaveLength(0)
    const early = window.order.map((id) => window.rows.get(id)!)
    // Followed threads from the first getView page, titled from their first words.
    expect(early.some((row) => row.id.startsWith('t:') && row.title !== '')).toBe(true)
    // DMs from client.counts alone: their time and an unread dot, no preview yet. Channels wait out of All until
    // Automated's rules have read their history, so a bot channel never shows there first.
    expect(early.find((row) => row.id === 'm:G0MAYALEO')!.preview.text).toBe('')
    expect(early.some((row) => row.id === 'm:C0ALERTSPROD')).toBe(false)
    // With history still held, the channels show after the hold, from client.counts alone.
    await time.advance(productionTiming.automatedHoldMillis)
    const held = await engine.rowsUntil((rows) => rows.some((row) => row.id === 'm:C0ALERTSPROD'), 'the channels after the hold')
    expect(held.find((row) => row.id === 'm:C0ALERTSPROD')).toMatchObject({ unreadCount: 1, unreadExact: false, preview: { text: '' } })

    // History lands while the boot is still running: previews and exact counts arrive in the same list, and the
    // bot channel is sorted into Automated as soon as its page is stored, before the boot ends.
    engine.fake.release({ method: 'conversations.history' })
    await engine.rowsUntil((rows) => rows.find((row) => row.id === 'm:G0MAYALEO')?.preview.text !== '', 'the DM preview from history')
    await engine.rowsUntil((rows) => !rows.some((row) => row.id === 'm:C0ALERTSPROD'), 'the bot channel out of All')
    // The discovery search runs before the boot ends, beside the held preview search: held, they keep the sync from reaching live.
    const discoveryHeld = () => engine.fake.heldCalls({ method: 'search.modules.messages' }).some((args) => args['_x_reason'] === 'discovery')
    await waitFor(() => (discoveryHeld() ? true : undefined), undefined, 'the discovery search')
    expect((await engine.phase('catching-up'))._tag).toBe('catching-up')
    engine.fake.release()
    await engine.phase('live')
  } finally {
    await time.close()
  }
})

it('names every row when it first shows, keeps a mention that arrives meanwhile unread, and lets no history page undo a newer event', async () => {
  // Every history page waits, one at a time, so neither names nor events can come from the end of the boot.
  const engine = await started({ initial: (fake) => (fake.holdNext({ method: 'conversations.history' }), fake.signIn()) })
  await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the first history page held')
  const { fake } = engine
  const flaky = threadId(fake, 'C0ENG', 'checkout.spec')
  const channel = String(fake.heldCalls({ method: 'conversations.history' })[0]!['channel'])
  const main = fake.workspace.main(channel)
  const edited = main.at(-1)!
  const reacted = main.at(-2) ?? edited
  let posted: { ts: string } | undefined

  await step('the followed threads are rows already, from getView, with every sender and mention named', async () => {
    expect(unnamed(await engine.rowsUntil((rows) => rows.length > 0, 'the followed threads'))).toEqual([])
  })

  await step('events land while the first page is in flight: an edit, a reaction, a post, and a mention in an unfollowed thread', async () => {
    await waitFor(() => (engine.online() ? true : undefined), undefined, 'the socket online')
    fake.editMessage({ channel, ts: edited.ts, text: 'Edited while the page was in flight.' })
    fake.addReaction({ channel, ts: reacted.ts, name: 'eyes', user: 'U0JONAS' })
    posted = fake.injectMessage({ channel, user: 'U0JONAS', text: 'Posted while the page was in flight.' })
    fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: '<@U0TUSHAR> can you take a look?', threadTs: tsOf(flaky) })
    await engine.socketIdle()
  })

  await step('history lands one conversation at a time, and each new row is named when it shows', async () => {
    for (let page = 1; page < activeMains; page++) {
      // `release` forgets the hold, so the next page is held again first.
      fake.release({ method: 'conversations.history' })
      fake.holdNext({ method: 'conversations.history' })
      await waitFor(() => (fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the next history page')
      expect(unnamed(await engine.rows())).toEqual([])
    }
    fake.release()
    await engine.phase('live', 30_000)
    const rows = await engine.rowsUntil((list) => list.some((row) => row.channel.kind === 'mpim'), 'the group DM')
    expect(rows.find((row) => row.channel.kind === 'mpim')?.channel.name).toBe('Maya, Leo')
    expect(unnamed(rows)).toEqual([])
  })

  await step('the mention followed the thread, as in Slack, with Slack\'s unread state', async () => {
    const sub = fake.workspace.subscription('C0ENG', tsOf(flaky))!
    const unread = fake.workspace.replies('C0ENG', tsOf(flaky)).filter((reply) => reply.ts > sub.lastRead && reply.user !== SELF_ID).length
    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === flaky && r.subscribed && r.unreadCount === unread), 'the mentioned thread, followed')
    expect(rows.find((r) => r.id === flaky)).toMatchObject({ mentionsMe: true })
  })

  await step('the held page did not undo the edit, the reaction or the post', async () => {
    await quiet(engine)
    const message = (ts: string) => readDb(engine, 'cache.db', (db) => db.prepare('SELECT text, edited_ts FROM messages WHERE channel = ? AND ts = ?').get(channel, ts)) as { text: string; edited_ts: string | null }
    expect(message(edited.ts)).toEqual({ text: 'Edited while the page was in flight.', edited_ts: fake.workspace.find(channel, edited.ts)!.edited!.ts })
    expect(message(posted!.ts).text).toBe('Posted while the page was in flight.')
    const reactions = readDb(engine, 'cache.db', (db) => db.prepare('SELECT user_ids_json FROM reactions WHERE channel = ? AND ts = ? AND name = ?').get(channel, reacted.ts, 'eyes')) as { user_ids_json: string } | undefined
    expect(JSON.parse(reactions?.user_ids_json ?? '[]')).toContain('U0JONAS')
  })
})

it('reads DMs (unread first), then mentions, then unread followed threads, then other unread channels, before the bulk', async () => {
  // Live in 2 to 5 s on a quiet machine, 7 to 23 s at four busy processes per core and 14 to 75 s at ten.
  const engine = await booted({ fakeOptions: { seed: largeSeed({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }) } }, 90_000)
  const ws = engine.fake.workspace
  const threads = ws.threadCounts()
  const members = [...ws.conversations.values()].filter((c) => c.members.has(SELF_ID))
  const isDirect = (c: (typeof members)[number]) => c.kind === 'im' || c.kind === 'mpim'
  const unreadDms = new Set(members.filter((c) => isDirect(c) && ws.countEntry(c).has_unreads).map((c) => c.id))
  const readDms = new Set(members.filter((c) => isDirect(c) && !ws.countEntry(c).has_unreads).map((c) => c.id))
  const mentioned = new Set(members.filter((c) => {
    const entry = ws.countEntry(c)
    return !isDirect(c) && ((entry.has_unreads && entry.mention_count > 0) || (threads.mention_count_by_channel?.[c.id] ?? 0) > 0)
  }).map((c) => c.id))
  const followed = new Set(members.filter((c) => !isDirect(c) && !mentioned.has(c.id) && (threads.unread_count_by_channel?.[c.id] ?? 0) > 0).map((c) => c.id))
  const unread = new Set(members.filter((c) => !isDirect(c) && !mentioned.has(c.id) && !followed.has(c.id) && ws.countEntry(c).has_unreads).map((c) => c.id))
  // Channels with nothing for the user: nothing unread, no followed reply, no message of their own.
  const bulk = new Set(members.filter((c) => !isDirect(c) && !mentioned.has(c.id) && !followed.has(c.id) && !unread.has(c.id) && !ws.main(c.id).some((m) => m.user === SELF_ID)).map((c) => c.id))
  const order = apiCalls(engine, 'conversations.history').map((call) => call.args['channel']!)
  const positions = (ids: ReadonlySet<string>) => order.flatMap((id, i) => (ids.has(id) ? [i] : []))
  const groups = [unreadDms, readDms, mentioned, followed, unread, bulk]
  for (const group of groups) expect(positions(group).length).toBeGreaterThan(0)
  // Each group is read before the next one starts.
  for (let i = 0; i + 1 < groups.length; i++) expect(Math.max(...positions(groups[i]!))).toBeLessThan(Math.min(...positions(groups[i + 1]!)))
}, 150_000)

it('Home is ready once DMs, mentions and unread followed threads have history, before the rest of history', async () => {
  // What Home is made of (SPEC 12, owner 10-18): DMs and group DMs, conversations with an unread mention, and those
  // with unread replies in a followed thread, inside the three-day topic window.
  const seed = largeSeed({ topics: 300, messages: 3_000, users: 100, channels: { public: 20, private: 6, dms: 8, mpims: 3 } })
  let forHome = new Set<string>()
  const engine = await started({
    fakeOptions: { seed },
    initial: (fake) => {
      const ws = fake.workspace
      const threads = ws.threadCounts()
      const windowStart = (Date.now() - 3 * DAY) / 1000
      forHome = new Set([...ws.conversations.values()].filter((c) => {
        if (!c.members.has(SELF_ID) || c.archived) return false
        const entry = ws.countEntry(c)
        if (entry.latest === undefined || Number(entry.latest) < windowStart) return false
        return c.kind === 'im' || c.kind === 'mpim' || (entry.has_unreads && entry.mention_count > 0)
          || (threads.mention_count_by_channel?.[c.id] ?? 0) > 0 || (threads.unread_count_by_channel?.[c.id] ?? 0) > 0
      }).map((c) => c.id))
      // The history of anything else waits, so the sync stops at the first conversation Home does not need.
      fake.gate((method, args) => method === 'conversations.history' && args['_x_reason'] === 'history' && !forHome.has(args['channel'] ?? ''))
      return fake.signIn()
    },
  })
  const unmount = engine.registry.mount(homeViewAtom)
  try {
    const home = () => {
      const result = engine.registry.get(homeViewAtom)
      return result._tag === 'Success' ? result.value : undefined
    }
    expect(forHome.size).toBeGreaterThan(3)
    await waitFor(() => (home()?.ready === true ? true : undefined), 30_000, 'Home ready')
    expect(home()?.firstSync).toBe(true)
    expect(engine.fake.gated().filter((call) => call.method === 'conversations.history')).toHaveLength(1)
    const read = new Set(apiCalls(engine, 'conversations.history').filter((call) => call.args['_x_reason'] === 'history').map((call) => call.args['channel']))
    expect([...forHome].filter((id) => !read.has(id))).toEqual([])
    expect((await engine.phase('catching-up'))._tag).toBe('catching-up')
    engine.fake.gate()
    await engine.phase('live', 30_000)
    await waitFor(() => (home()?.firstSync === false && home()?.ready === true ? true : undefined), WAIT_MS, 'Home after the boot')
  } finally {
    unmount()
  }
}, 60_000)

it("with the app's pacing, reads thread previews and emoji beside history, not after it", async () => {
  // Pacing ten times faster than the app's, every method alike, so the methods keep their real ratios; live calls took
  // about 450 ms (performance.md, "First sync timeline"), scaled the same way. Ten active conversations and 40 threads.
  const seed = largeSeed({ topics: 40, messages: 600, users: 80, days: 7, channels: { public: 6, private: 1, dms: 2, mpims: 1 } })
  const engine = await booted({ paced: 10, fakeOptions: { seed, latencyMillis: 45 } }, 30_000)
  const history = apiCalls(engine, 'conversations.history').filter((call) => call.args['_x_reason'] === 'history')
  const previews = apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'thread-preview')
  const emoji = engine.fake.calls.filter((call) => call.method === 'emojis/list')
  const lastHistory = Math.max(...history.map((call) => call.at))
  expect(history.length).toBeGreaterThanOrEqual(8)
  expect(previews.length).toBeGreaterThanOrEqual(4)
  expect(Math.min(...previews.map((call) => call.at))).toBeLessThan(lastHistory)
  expect(emoji.length).toBeGreaterThan(0)
  expect(Math.min(...emoji.map((call) => call.at))).toBeLessThan(lastHistory)
}, 60_000)

it("on Grid, keys the workspace by enterprise and team, keeps a Main alive by an old thread's reply, and decodes Slack's escaping", async () => {
  let escaped: SeededThread | undefined
  const engine = await booted({
    enterpriseId: 'E0ORG',
    initial: (fake) => {
      // A channel the user is in with nothing in the window but one reply, from yesterday, to a month-old root.
      fake.workspace.addConversation({ id: 'C0ARCHITECTURE', name: 'architecture', kind: 'public', members: new Set([SELF_ID, 'U0LEO', 'U0MAYA']), created: fake.now() - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
      seedThread(fake, { channel: 'C0ARCHITECTURE', text: 'Old proposal', ago: 30 * DAY, replies: [30 * DAY, DAY], follow: false })
      // The fake stores fixture text as Slack does: `->` arrives as `-&gt;`, `&` as `&amp;`.
      escaped = seedThread(fake, { channel: 'C0ENG', text: 'is the granola mcp -> action items flow live for <@U0DEV> & QA?', ago: 60 * 60_000, replies: [30 * 60_000], follow: true })
      return fake.signIn()
    },
  })
  expect(existsSync(join(engine.userData, 'workspaces', `E0ORG-${engine.fake.teamId}`, 'cache.db'))).toBe(true)
  expect(existsSync(join(engine.userData, 'workspaces', 'E0ORG'))).toBe(false)
  const rows = await engine.rowsUntil((list) => list.some((r) => r.id === 'm:C0ARCHITECTURE') && list.some((r) => r.id === escaped!.id), 'the kept Main and the escaped thread')
  expect(rows.find((r) => r.id === 'm:C0ARCHITECTURE')).toMatchObject({ kind: 'main', title: '#architecture' })
  const row = rows.find((r) => r.id === escaped!.id)!
  expect(row.title).toBe('is the granola mcp -> action…')
  expect(row.preview).toEqual({ sender: 'Maya', text: 'is the granola mcp -> action items flow live for @Dev & QA? reply 1' })
})

// A first sync that fails part way
it('an interrupted cold boot does not fetch again the history it already has', async () => {
  const engine = await started({ initial: (fake) => (fake.holdNext({ method: 'conversations.history' }), fake.signIn()) })
  await waitFor(() => (engine.fake.heldCount({ method: 'conversations.history' }) === 1 ? true : undefined), 20_000, 'the first history page held')
  // The first conversation's page lands; the second keeps failing (every retry), so the boot fails and waits to try again.
  engine.fake.forceError({ method: 'conversations.history', error: 'internal_error', times: 3 })
  engine.fake.release()
  await engine.phase('failed', 30_000)
  expect(apiCalls(engine, 'conversations.history').filter((c) => c.ok)).toHaveLength(1)
  engine.fake.resetCalls()
  // force_reload cuts the retry wait short; the next boot skips the conversation it already has.
  engine.fake.emitFrame({ type: 'force_reload', event_ts: `${Math.floor(Date.now() / 1000)}.000001` })
  await engine.phase('live', 30_000)
  await quiet(engine)
  expect(apiCalls(engine, 'conversations.history')).toHaveLength(activeMains - 1)
})

it('reads history over the quiet window the user chose, finishes when discovery fails, and the next sweep searches the same gap', async () => {
  // The preview search after the quick start, then the discovery sweep, are refused.
  const engine = await booted({ quietDays: 3, initial: (fake) => (fake.forceError({ method: 'search.modules.messages', error: 'not_allowed', times: 2 }), fake.signIn()) })

  await step('history pages start at the 3-day window, or earlier at an older read pointer, so unread counts are exact', async () => {
    const start = Date.now() / 1000 - 3 * 86_400
    const oldest = apiCalls(engine, 'conversations.history').map((call) => Number(call.args['oldest']))
    expect(oldest.some((o) => Math.abs(o - start) < 120)).toBe(true)
    expect(oldest.every((o) => o < start + 120)).toBe(true)
  })

  await step('the boot finished live with both searches refused; the catch-up searches from the start of the window again', async () => {
    await quiet(engine)
    const searches = () => apiCalls(engine, 'search.modules.messages')
    expect(searches().map((c) => [c.args['_x_reason'], c.ok])).toEqual([['previews', false], ['discovery', false]])
    const failedQuery = String(searches()[1]!.args['query'])
    engine.fake.resetCalls()
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await quiet(engine)
    const query = String(searches()[0]!.args['query'])
    expect(/after:(\d{4}-\d{2}-\d{2})/.exec(query)![1]).toBe(/after:(\d{4}-\d{2}-\d{2})/.exec(failedQuery)![1])
  })
})
