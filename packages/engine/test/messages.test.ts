// The topic view's data end to end (M4, WP1): the engine boots against the
// fake, the renderer's atoms subscribe to a topic's messages and header over
// the port, `topics.open` and `messages.loadOlder` fetch what the store
// lacks, and socket events change exactly the rows they touch.
import { Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageView, type ThreadSummary, type TopicDetail } from '@juno/contract'
import {
  channelThreadsAtom,
  loadOlderMessages,
  locateMessage,
  messagesAtom,
  openTopic,
  prefetchTopic,
  topicAtom,
  type ListWindow,
  type LiveListAtom,
  type LiveValueAtom,
} from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine as boot, DAY, quiet, readDb, seedThread, threadId, valueOf } from './scenario'

/** A thread from three weeks ago, posted with no events: the store knows nothing of it. */
const oldThread = (engine: RunningEngine) =>
  seedThread(engine.fake, { channel: 'C0ENG', text: 'Old thread about lag', ago: 21 * DAY, replies: [21 * DAY - 60_000], follow: false }).id

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const bootedEngine = async () => {
  const engine = await boot(engines)
  // Boot's background passes are done, so every call counted below is the test's.
  await quiet(engine)
  return engine
}

/** A mounted list atom and ways to read it. */
function watchList<Row, E>(engine: RunningEngine, atom: LiveListAtom<Row, E>) {
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<Row> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  return {
    current: () => current()!,
    until: (predicate: (window: ListWindow<Row>) => boolean, label: string) =>
      waitFor(() => {
        const window = current()
        return window !== undefined && predicate(window) ? window : undefined
      }, WAIT_MS, label),
  }
}

function watchValue<A, E>(engine: RunningEngine, atom: LiveValueAtom<A, E>) {
  unmounts.push(engine.registry.mount(atom))
  return {
    until: (predicate: (value: A) => boolean, label: string) =>
      waitFor(() => {
        const result = engine.registry.get(atom)
        return result._tag === 'Success' && predicate(result.value) ? { value: result.value } : undefined
      }, WAIT_MS, label).then((found) => found.value),
  }
}

const rowsOf = <Row>(window: ListWindow<Row>) => window.order.map((id) => window.rows.get(id)!)

/** Text of a body's paragraphs, for assertions. */
const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

/** Ids of rows whose object changed or appeared between two windows. */
const changedRows = <Row>(before: ListWindow<Row>, after: ListWindow<Row>) => after.order.filter((id) => before.rows.get(id) !== after.rows.get(id))

const encodeMessage = Schema.encodeSync(Schema.toCodecJson(MessageView))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const conversationCalls = (engine: RunningEngine) => apiCalls(engine).filter((call) => call.method.startsWith('conversations.'))

it('shows each bot message name and icon without changing other bot senders', async () => {
  const engine = await boot(engines)
  const list = watchList(engine, messagesAtom('m:C0ENG'))
  const messages = [
    { ts: `${Math.floor(engine.fake.now() / 1000)}.900001`, username: 'Release helper', bot_profile: { id: 'B0TEST', name: 'Build helper', icons: { image_72: 'https://example.test/build.png' } } },
    { ts: `${Math.floor(engine.fake.now() / 1000)}.900002`, bot_profile: { id: 'B0TEST', name: 'Build helper', icons: { image_48: 'https://example.test/other.png' } } },
  ]
  for (const message of messages) engine.fake.emitFrame({ type: 'message', channel: 'C0ENG', subtype: 'bot_message', bot_id: 'B0TEST', text: 'Synthetic build status', ...message })
  const window = await list.until((value) => messages.every((message) => value.rows.has(message.ts)), 'bot messages')
  const senders = messages.map((message) => window.refs.people.get(window.rows.get(message.ts)!.senderId!))
  expect(senders[0]).toMatchObject({ name: 'Release helper', avatarUrl: 'https://example.test/build.png' })
  expect(senders[1]).toMatchObject({ name: 'Build helper', avatarUrl: 'https://example.test/other.png' })
  const stored = readDb(engine, 'cache.db', (db) => db.prepare('SELECT bot_name, bot_icon FROM messages WHERE ts = ?').get(messages[0]!.ts))
  expect(stored).toEqual({ bot_name: 'Release helper', bot_icon: 'https://example.test/build.png' })
  const topics = await engine.rowsUntil((rows) => rows.find((row) => row.id === 'm:C0ENG')?.preview.sender === 'Build helper', 'bot preview')
  expect(topics.find((row) => row.id === 'm:C0ENG')?.preview.sender).toBe('Build helper')
})

it('marks mentions of stored user groups as yours and leaves other groups plain', async () => {
  const engine = await boot(engines, { initial: (fake) => {
    fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
    return fake.signIn()
  } })
  const list = watchList(engine, messagesAtom('m:C0ENG'))
  const own = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0PLATFORM|@platform> Review this.' })
  const other = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0OTHER|@other> Review this.' })
  const window = await list.until((value) => value.rows.has(other.ts), 'group mentions')
  const group = (ts: string) => window.rows.get(ts)?.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).find((inline) => inline.kind === 'usergroup')
  expect([group(own.ts), group(other.ts)]).toMatchObject([{ id: 'S0PLATFORM', isMine: true }, { id: 'S0OTHER', isMine: false }])
})

describe('locating a message for a link', () => {
  it('names the thread of a reply and of a root, and Main for the rest', async () => {
    const engine = await bootedEngine()
    const id = oldThread(engine)
    const list = watchList(engine, messagesAtom(id))
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    const [root, reply] = rowsOf(await list.until((window) => window.order.length === 2, 'the root and its reply'))
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', reply!.ts))).toEqual({ topicId: id, stored: true, place: '#eng' })
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', root!.ts))).toEqual({ topicId: id, stored: true, place: '#eng' })
    const deploys = rowsOf(await watchList(engine, messagesAtom('m:C0DEPLOYS')).until((window) => window.order.length > 0, 'a deploy'))
    expect(valueOf(await locateMessage(engine.registry, 'C0DEPLOYS', deploys[0]!.ts))).toEqual({ topicId: 'm:C0DEPLOYS', stored: true, place: '#deploys' })
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', '1.000001'))).toEqual({ topicId: 'm:C0ENG', stored: false, place: '#eng' })
  })
})

describe('opening a topic', () => {
  it('fetches an unstored thread with one replies call, then only what is newer', async () => {
    const engine = await bootedEngine()
    const id = oldThread(engine)
    engine.fake.resetCalls()
    const list = watchList(engine, messagesAtom(id))
    const header = watchValue(engine, topicAtom(id))

    // Before the open the store has nothing: a header from the conversation and no rows, and no call to Slack.
    const bare = await header.until((detail) => detail !== null, 'the header of an unstored thread')
    expect(bare).toMatchObject({ kind: 'thread', title: '#eng', titleSource: 'channel', channel: { id: 'C0ENG', label: '#eng' } })
    expect(await list.until(() => true, 'the empty window')).toMatchObject({ order: [], meta: { windowCovered: false } })
    expect(apiCalls(engine)).toHaveLength(0)

    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    expect(apiCalls(engine, 'conversations.replies')).toHaveLength(1)
    const rows = rowsOf(await list.until((window) => window.order.length === 2, 'the root and its reply'))
    expect(rows.map((row) => [row.root, row.senderId, textOf(row)])).toEqual([
      [true, 'U0LEO', 'Old thread about lag'],
      [false, 'U0MAYA', 'Old thread about lag reply 1'],
    ])
    expect(rows.every((row) => row.groupStart)).toBe(true)
    await header.until((detail) => detail?.title === 'Old thread about lag', 'the title from the root')
    const window = await list.until((value) => value.meta.windowCovered === true, 'history coverage')
    expect(window.refs.people.get('U0MAYA')?.name).toBe('Maya')

    // Every reply is stored now: the second open asks only for replies after the newest one.
    engine.fake.resetCalls()
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    const again = apiCalls(engine, 'conversations.replies')
    expect(again).toHaveLength(1)
    expect(again[0]!.args['oldest']).toBe(rows[1]!.ts)
  })

  it('reads Main from where its synced range ends', async () => {
    const engine = await bootedEngine()
    const id = 'm:C0DEPLOYS'
    const list = watchList(engine, messagesAtom(id))
    const before = await list.until((window) => window.order.length === 6, 'the six deploys')
    expect(rowsOf(before).every((row) => before.refs.people.get(row.senderId!)?.name === 'Deploy Bot')).toBe(true)
    // One sender, but more than ten minutes apart: each has its own header.
    expect(rowsOf(before).map((row) => row.groupStart)).toEqual([true, true, true, true, true, true])

    // A message the socket never delivered.
    const missed = engine.fake.workspace.post({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: 'api@5d0e11 deployed to prod', silent: true })
    const rangeEnd = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT max(to_ts) AS to_ts FROM synced_ranges WHERE channel = 'C0DEPLOYS'`).get() as { to_ts: string })
    engine.fake.resetCalls()
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    // First what is newer than the range; then, because #deploys was never read, older pages back to its start.
    const calls = conversationCalls(engine)
    expect(calls.every((call) => call.method === 'conversations.history')).toBe(true)
    expect(calls[0]!.args['oldest']).toBe(rangeEnd.to_ts)
    expect(calls.slice(1).every((call) => call.args['latest'] !== undefined)).toBe(true)
    const after = await list.until((window) => window.order.length === 7, 'the missed message')
    expect(after.order.at(-1)).toBe(missed.ts)
    // The rows that were there keep their objects.
    expect(changedRows(before, after)).toEqual([missed.ts])
  })

  it('opens an uncached topic offline with its header and an empty list', async () => {
    const engine = await bootedEngine()
    const id = oldThread(engine)
    engine.main.network.offline = true
    engine.fake.goOffline()
    const list = watchList(engine, messagesAtom(id))
    const header = watchValue(engine, topicAtom(id))
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('offline')
    expect(await header.until((detail) => detail !== null, 'the header')).toMatchObject({ channel: { label: '#eng' }, messageCount: 0 })
    expect((await list.until(() => true, 'the window')).order).toEqual([])
  })

  it('serves a prefetch from the store without calling Slack', async () => {
    const engine = await bootedEngine()
    const id = threadId(engine.fake, 'C0PRODUCT', 'Proposal: cut offline mode')
    engine.fake.resetCalls()
    prefetchTopic(engine.registry, id)
    await waitFor(() => {
      const result = engine.registry.get(messagesAtom(id))
      return result._tag === 'Success' && result.value.meta.seq > 0 && result.value.order.length > 0 ? true : undefined
    }, WAIT_MS, 'the prefetched window')
    await engine.syncIdle()
    expect(conversationCalls(engine)).toHaveLength(0)
  })
})

describe('older messages', () => {
  it('fetches the page before the window once, then reports the start', async () => {
    // 150 deploys from three weeks ago, before the quiet window the boot reads. The channel is read, so the
    // boot's page does not reach back to an older read pointer.
    const engine = await boot(engines, {
      initial: (fake) => {
        const start = fake.now() - 21 * DAY
        for (let i = 0; i < 150; i++) fake.workspace.post({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: `old deploy ${i}`, at: start + i * 60_000, silent: true })
        fake.markRead({ channel: 'C0DEPLOYS', ts: fake.messages('C0DEPLOYS').at(-1)!.ts })
        return fake.signIn()
      },
    })
    await quiet(engine)
    const id = 'm:C0DEPLOYS'
    const bottom = await watchList(engine, messagesAtom(id)).until((window) => window.order.length === 6, 'the recent deploys')
    const first = bottom.order[0]!

    engine.fake.resetCalls()
    const older = valueOf(await loadOlderMessages(engine.registry, id, first))
    expect(older).toEqual({ outcome: 'fetched', complete: false })
    expect(conversationCalls(engine).map((call) => call.method)).toEqual(['conversations.history'])

    // The container widens the window: 100 rows before the old first row, which keeps its place after them.
    const wider = await watchList(engine, messagesAtom(id, { anchor: first, before: 100, limit: 106 })).until((window) => window.order.length === 106, 'the wider window')
    expect(wider.order.slice(100)).toEqual(bottom.order)
    expect(textOf(wider.rows.get(wider.order[0]!)!)).toBe('old deploy 50')
    // The old first row comes weeks after the bot's last old deploy, so it has a header, in this window and in the one that starts with it.
    expect(wider.rows.get(first)!.groupStart).toBe(true)
    const recent = await watchList(engine, messagesAtom(id, { limit: 6 })).until((window) => window.order.length === 6, 'the recent deploys again')
    expect(recent.rows.get(first)!.groupStart).toBe(true)

    // Asking again for the same page needs no call; the last 50 make one more, which reaches the start.
    engine.fake.resetCalls()
    expect(valueOf(await loadOlderMessages(engine.registry, id, wider.order[0]!))).toEqual({ outcome: 'fetched', complete: true })
    expect(valueOf(await loadOlderMessages(engine.registry, id, wider.order[0]!))).toEqual({ outcome: 'cached', complete: true })
    expect(conversationCalls(engine)).toHaveLength(1)
    // Now 'old deploy 49' is stored, just before the window, a minute before 'old deploy 50', which continues its run and loses its header.
    await watchList(engine, messagesAtom(id, { anchor: first, before: 100, limit: 106 })).until((window) => window.rows.get(window.order[0]!)!.groupStart === false, 'the first row without a header')
  })
})

/** The Postgres thread, opened so every reply is stored, and its window. */
const openPostgres = async (engine: RunningEngine) => {
  const id = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
  valueOf(await openTopic(engine.registry, id))
  const list = watchList(engine, messagesAtom(id))
  await list.until((window) => window.order.length === 7, 'the root and six replies')
  return { id, list, rootTs: id.split(':')[2]! }
}

describe('live messages', () => {
  it('adds a reply from another client as one row, in a small delta', async () => {
    const engine = await bootedEngine()
    const { list, rootTs } = await openPostgres(engine)
    const before = list.current()
    const reply = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', threadTs: rootTs, text: 'Cutover is a go' })
    const after = await list.until((window) => window.order.length === 8, 'the new reply')
    expect(changedRows(before, after)).toEqual([reply.ts])
    const row = after.rows.get(reply.ts)!
    expect(row).toMatchObject({ senderId: 'U0SAM', groupStart: true, fromMe: false })
    expect(after.refs.people.get('U0SAM')?.name).toBe('Sam')
    expect(bytes([encodeMessage(row)])).toBeLessThan(32 * 1024)
  })

  it('changes one row for an edit, a reaction and a deleted root', async () => {
    const engine = await bootedEngine()
    const { list, rootTs } = await openPostgres(engine)
    const [, second, third] = list.current().order

    let before = list.current()
    engine.fake.editMessage({ channel: 'C0ENG', ts: second!, text: 'Four minutes is fine for us.' })
    let after = await list.until((window) => window.rows.get(second!)?.edited === true, 'the edit')
    expect(changedRows(before, after)).toEqual([second])
    expect(textOf(after.rows.get(second!)!)).toBe('Four minutes is fine for us.')

    before = after
    engine.fake.addReaction({ channel: 'C0ENG', ts: third!, name: 'eyes', user: 'U0SAM' })
    after = await list.until((window) => window.rows.get(third!)?.reactions.some((r) => r.name === 'eyes') === true, 'the reaction')
    expect(changedRows(before, after)).toEqual([third])
    expect(after.rows.get(third!)!.reactions.find((r) => r.name === 'eyes')).toEqual({ name: 'eyes', count: 1, me: false, unicode: '👀', users: ['U0SAM'] })

    before = after
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: rootTs })
    after = await list.until((window) => window.rows.get(rootTs)?.kind === 'deleted', 'the deleted root')
    expect(changedRows(before, after)).toEqual([rootTs])
    expect(after.order).toHaveLength(7)
  })

  it("updates a Main message's thread link when its thread gets a reply", async () => {
    const engine = await bootedEngine()
    const id = threadId(engine.fake, 'C0ENG', 'Unrelated: has anyone looked')
    const rootTs = id.split(':')[2]!
    const list = watchList(engine, messagesAtom('m:C0ENG'))
    const before = await list.until((window) => window.rows.get(rootTs)?.thread !== undefined, 'the thread link')
    expect(before.rows.get(rootTs)!.thread).toMatchObject({ id, replyCount: 2, label: '2 replies' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', threadTs: rootTs, text: 'Reaper is merged.' })
    const after = await list.until((window) => window.rows.get(rootTs)?.thread?.replyCount === 3, 'the new count')
    expect(after.rows.get(rootTs)!.thread!.label).toBe('3 replies')
    expect(changedRows(before, after)).toEqual([rootTs])
  })

  it("sends a person's new photo as one ref and changes no row", async () => {
    const engine = await bootedEngine()
    const { list } = await openPostgres(engine)
    const sidebar = await engine.rowsUntil((rows) => rows.some((row) => row.participants.some((p) => p.id === 'U0LEO')), 'a sidebar row with Leo')
    const before = list.current()
    const sidebarBefore = new Map(sidebar.map((row) => [row.id, row]))
    const leo = engine.fake.workspace.users.get('U0LEO')!
    const photo = `${engine.fake.url}/avatars/U0LEO-new.png`
    const updated = { ...leo, profile: { ...leo.profile, image_72: photo, image_48: `${photo}?size=48`, image_192: `${photo}?size=192` } }
    engine.fake.workspace.users.set('U0LEO', updated)
    engine.fake.workspace.emit({ type: 'user_change', user: updated } as Parameters<typeof engine.fake.workspace.emit>[0])
    const after = await list.until((window) => window.refs.people.get('U0LEO')?.avatarUrl === photo, 'the new photo in refs')
    expect(after.refs.people.get('U0LEO')).toMatchObject({ avatarSmallUrl: `${photo}?size=48`, avatarLargeUrl: `${photo}?size=192` })
    expect(changedRows(before, after)).toEqual([])
    // Rows that show Leo (the stack or a group DM's tile) get the new photo with the same rev; the others keep their object.
    const shown = await engine.rowsUntil((rows) => rows.some((row) => row.participants.some((p) => p.id === 'U0LEO' && p.avatarUrl === photo)), 'the new photo in the sidebar')
    for (const row of shown) {
      expect(row.rev).toBe(sidebarBefore.get(row.id)?.rev)
      if (![...row.participants, ...(row.channel.members ?? [])].some((p) => p.id === 'U0LEO')) expect(row).toBe(sidebarBefore.get(row.id))
    }
  })
})

describe('files', () => {
  it('gives an image a juno:// thumbnail with its box before the bytes arrive, and the original for the viewer', async () => {
    const engine = await bootedEngine()
    const file = {
      id: 'F0CHART',
      name: 'latency.png',
      title: 'latency.png',
      mimetype: 'image/png',
      size: 48_000,
      original_w: 1600,
      original_h: 900,
      url_private: `${engine.fake.url}/files/F0CHART/latency.png`,
      thumb_360: `${engine.fake.url}/files-tmb/F0CHART/latency_360.png`,
      thumb_360_w: 360,
      thumb_360_h: 203,
      thumb_720: `${engine.fake.url}/files-tmb/F0CHART/latency_720.png`,
    }
    // Posted with no event: the open brings it.
    const posted = engine.fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0JONAS', text: 'Latency after the fix', files: [file], silent: true })
    valueOf(await openTopic(engine.registry, 'm:C0INCIDENTS'))
    const list = watchList(engine, messagesAtom('m:C0INCIDENTS'))
    const window = await list.until((w) => (w.rows.get(posted.ts)?.files.length ?? 0) > 0, 'the file')
    const row = window.rows.get(posted.ts)!
    expect(row.files).toEqual([
      {
        id: 'F0CHART',
        name: 'latency.png',
        kind: 'image',
        mimetype: 'image/png',
        size: 48_000,
        width: 1600,
        height: 900,
        thumb: { src: `juno://files/F0CHART/720?url=${encodeURIComponent(file.thumb_720)}`, width: 360, height: 203 },
        full: `juno://files/F0CHART/full?url=${encodeURIComponent(file.url_private)}`,
      },
    ])
    expect(row.body.blocks.some((block) => block.kind === 'file' && block.id === 'F0CHART')).toBe(true)
  })
})

describe("Main's active threads", () => {
  it('lists the threads of the quiet window, newest first, with their reply counts', async () => {
    const engine = await bootedEngine()
    const threads = watchList(engine, channelThreadsAtom('C0ENG'))
    const window = await threads.until((w) => w.order.length >= 3, 'the threads')
    const rows: ReadonlyArray<ThreadSummary> = rowsOf(window)
    expect(rows.map((row) => row.lastActivityAt)).toEqual(rows.map((row) => row.lastActivityAt).toSorted((a, b) => b - a))
    const checkout = rows.find((row) => row.title.startsWith('checkout.spec'))!
    expect(checkout).toMatchObject({ replyCount: 5 })
    expect(rows.find((row) => row.title.startsWith('Draft plan'))).toMatchObject({ replyCount: 6 })
    // The Kafka thread from eight days ago is outside the window.
    expect(rows.some((row) => row.title.startsWith('Lag alerts'))).toBe(false)
    expect(window.meta.total).toBe(rows.length)
    for (const row of rows) for (const person of row.participantIds) expect(window.refs.people.has(person)).toBe(true)

    const header = watchValue(engine, topicAtom('m:C0ENG'))
    const detail: TopicDetail | null = await header.until((d) => d !== null, 'the Main header')
    expect(detail).toMatchObject({ kind: 'main', title: '#eng', threadCount: rows.length })
  })
})
