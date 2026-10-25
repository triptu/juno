// The topic view against the fake Slack (M4, architecture 5.5): opening a topic fetches only what the
// store lacks, older history comes a page at a time and once, a window is covered only by a page that
// confirms it, live changes reach exactly the rows they touch, links find their topic (SPEC 8, "Links"),
// names stand in for mentions, user groups and escapes, Main's thread links preview their first reply, and
// an image Slack filled in late becomes the picture when its topic opens (architecture 9, "Late thumbnails").
// The older-history test cold-boots to seed history before the first sync; every other test starts warm on
// the synced default workspace.
import { Schema } from 'effect'
import { afterEach, expect, it } from 'bun:test'
import { MessageView, type ThreadSummary, type TopicDetail } from '@juno/contract'
import type { FakeSlack } from '@juno/fake-slack'
import { channelThreadsAtom, loadMessageAt, loadOlderMessages, locateMessage, locatePerson, messagesAtom, openTopic, prefetchTopic, topicAtom, type ListWindow, type LiveListAtom, type LiveValueAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { apiCalls, bootedEngine, DAY, quiet, seedThread, threadId, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = () => syncedEngine(engines)

/** A mounted list atom: its current window, and a wait for a window `predicate` accepts. */
function watchList<Row, E>(engine: RunningEngine, atom: LiveListAtom<Row, E>) {
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<Row> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  const until = (predicate: (window: ListWindow<Row>) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      return window !== undefined && predicate(window) ? window : undefined
    }, WAIT_MS, label)
  return { current: () => current()!, until }
}

function watchValue<A, E>(engine: RunningEngine, atom: LiveValueAtom<A, E>) {
  unmounts.push(engine.registry.mount(atom))
  return (predicate: (value: A) => boolean, label: string) =>
    waitFor(() => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && predicate(result.value) ? { value: result.value } : undefined
    }, WAIT_MS, label).then((found) => found.value)
}

const rowsOf = <Row>(window: ListWindow<Row>) => window.order.map((id) => window.rows.get(id)!)

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

/** Ids of rows whose object changed or appeared between two windows. */
const changedRows = <Row>(before: ListWindow<Row>, after: ListWindow<Row>) => after.order.filter((id) => before.rows.get(id) !== after.rows.get(id))

/** The calls a topic open or a load of older messages made; other work runs on its own reasons. */
const opens = (engine: RunningEngine) => apiCalls(engine).filter((call) => call.args['_x_reason'] === 'open')

const encodeMessage = Schema.encodeSync(Schema.toCodecJson(MessageView))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

/** A thread from three weeks ago, posted with no events: the store knows nothing of it. */
const oldThread = (fake: FakeSlack, text: string) => seedThread(fake, { channel: 'C0ENG', text, ago: 21 * DAY, replies: [21 * DAY - 60_000], follow: false }).id

it('opening a topic fetches only what the store lacks, and a link finds its topic', async () => {
  const engine = await synced()
  const id = oldThread(engine.fake, 'Old thread about lag')
  engine.fake.resetCalls()
  const list = watchList(engine, messagesAtom(id))
  const header = watchValue(engine, topicAtom(id))

  await step('before the open, an unstored thread shows its channel as the header and an empty window, asking Slack nothing', async () => {
    expect(await header((detail) => detail !== null, 'the header of an unstored thread')).toMatchObject({ kind: 'thread', title: '#eng', titleSource: 'channel', channel: { id: 'C0ENG', label: '#eng' } })
    expect(await list.until(() => true, 'the empty window')).toMatchObject({ order: [], meta: { windowCovered: false } })
    expect(opens(engine)).toHaveLength(0)
  })

  await step('the open fetches the root and its reply with one call, titles the thread and covers the window', async () => {
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    expect(opens(engine).map((call) => call.method)).toEqual(['conversations.replies'])
    const window = await list.until((value) => value.order.length === 2 && value.meta.windowCovered === true, 'the root and its reply, covered')
    expect(rowsOf(window).map((row) => [row.root, row.senderId, textOf(row)])).toEqual([
      [true, 'U0LEO', 'Old thread about lag'],
      [false, 'U0MAYA', 'Old thread about lag reply 1'],
    ])
    expect(window.refs.people.get('U0MAYA')?.name).toBe('Maya')
    await header((detail) => detail?.title === 'Old thread about lag', 'the title from the root')
  })

  await step('a second open asks only for replies after what the first one proved', async () => {
    const newest = list.current().order.at(-1)!
    engine.fake.resetCalls()
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    const again = opens(engine)
    expect(again.map((call) => call.method)).toEqual(['conversations.replies'])
    expect(again[0]!.args['oldest']! >= newest).toBe(true)
  })

  await step('opening Main asks only for what is newer than its stored history, and the rows it had keep their objects', async () => {
    const deploys = watchList(engine, messagesAtom('m:C0DEPLOYS'))
    const before = await deploys.until((window) => window.order.length === 6, 'the six deploys')
    const url = `${engine.fake.url}/files/F0CHART/latency`
    const file = { id: 'F0CHART', name: 'latency.png', title: 'latency.png', mimetype: 'image/png', size: 48_000, original_w: 1600, original_h: 900, url_private: `${url}.png`, thumb_360: `${url}_360.png`, thumb_360_w: 360, thumb_360_h: 203, thumb_720: `${url}_720.png` }
    // A message with a picture the socket never delivered.
    const missed = engine.fake.workspace.post({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: 'api@5d0e11 deployed to prod', files: [file], silent: true })
    engine.fake.resetCalls()
    expect(valueOf(await openTopic(engine.registry, 'm:C0DEPLOYS')).outcome).toBe('fetched')
    const calls = opens(engine)
    expect(calls.every((call) => call.method === 'conversations.history')).toBe(true)
    expect(Number(calls[0]!.args['oldest'])).toBeGreaterThanOrEqual(Number(before.order.at(-1)))
    const after = await deploys.until((window) => window.order.length === 7, 'the missed message')
    expect(after.order.at(-1)).toBe(missed.ts)
    expect(changedRows(before, after)).toEqual([missed.ts])
    // The picture's box is known before its bytes arrive, so the row does not jump when they do.
    const row = after.rows.get(missed.ts)!
    expect(row.files).toMatchObject([{ id: 'F0CHART', kind: 'image', width: 1600, height: 900, thumb: { width: 360, height: 203 } }])
    expect(row.body.blocks.some((block) => block.kind === 'file' && block.id === 'F0CHART')).toBe(true)
  })

  await step('a prefetch shows the stored window without opening the topic in Slack', async () => {
    const proposal = threadId(engine.fake, 'C0PRODUCT', 'Proposal: cut offline mode')
    engine.fake.resetCalls()
    prefetchTopic(engine.registry, proposal)
    await waitFor(() => {
      const result = engine.registry.get(messagesAtom(proposal))
      return result._tag === 'Success' && result.value.meta.seq > 0 && result.value.order.length > 0 ? true : undefined
    }, WAIT_MS, 'the prefetched window')
    await quiet(engine)
    expect(opens(engine)).toHaveLength(0)
  })

  await step("Main's Threads list holds the quiet window's threads, newest first, with their reply counts", async () => {
    const window = await watchList(engine, channelThreadsAtom('C0ENG')).until((w) => w.order.length >= 3, 'the threads')
    const rows: ReadonlyArray<ThreadSummary> = rowsOf(window)
    expect(rows.map((row) => row.lastActivityAt)).toEqual(rows.map((row) => row.lastActivityAt).toSorted((a, b) => b - a))
    expect(rows.find((row) => row.title.startsWith('checkout.spec'))).toMatchObject({ replyCount: 5 })
    expect(rows.find((row) => row.title.startsWith('Draft plan'))).toMatchObject({ replyCount: 6 })
    // The Kafka thread from eight days ago and the one opened above, from three weeks ago, are outside the window.
    expect(rows.some((row) => row.title.startsWith('Lag alerts') || row.title.startsWith('Old thread'))).toBe(false)
    for (const row of rows) for (const person of row.participantIds) expect(window.refs.people.has(person)).toBe(true)
    const main: TopicDetail | null = await watchValue(engine, topicAtom('m:C0ENG'))((detail) => detail !== null, 'the Main header')
    expect(main).toMatchObject({ kind: 'main', title: '#eng', threadCount: rows.length })
  })

  await step('a link finds the thread of a reply or a root, Main for other messages, and the DM of a person', async () => {
    const [root, reply] = list.current().order
    const deploy = (await watchList(engine, messagesAtom('m:C0DEPLOYS')).until((w) => w.order.length > 0, 'a deploy')).order[0]!
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', reply!))).toEqual({ topicId: id, stored: true, place: '#eng' })
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', root!))).toEqual({ topicId: id, stored: true, place: '#eng' })
    expect(valueOf(await locateMessage(engine.registry, 'C0DEPLOYS', deploy))).toEqual({ topicId: 'm:C0DEPLOYS', stored: true, place: '#deploys' })
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', '1.000001'))).toEqual({ topicId: 'm:C0ENG', stored: false, place: '#eng' })
    // A link that names its thread goes there even when the store lacks the reply.
    expect(valueOf(await locateMessage(engine.registry, 'C0ENG', '2.000002', '1.000001'))).toEqual({ topicId: 't:C0ENG:1.000001', stored: false, place: '#eng' })
    expect(valueOf(await locateMessage(engine.registry, 'D0MAYA', '1.000001')).place).toBe('Maya Chen')
    expect(valueOf(await locateMessage(engine.registry, 'C0NOWHERE', '1.000001'))).toEqual({ topicId: 'm:C0NOWHERE', stored: false })
    expect(valueOf(await locatePerson(engine.registry, 'U0MAYA'))).toMatchObject({ person: { name: 'Maya Chen' }, mainId: 'm:D0MAYA' })
    expect(valueOf(await locatePerson(engine.registry, 'U0NOBODY'))).toEqual({})
  })

  await step('offline, an uncached topic opens with its header and an empty list', async () => {
    const unseen = oldThread(engine.fake, 'Old thread about disks')
    engine.main.network.offline = true
    engine.fake.goOffline()
    const unseenList = watchList(engine, messagesAtom(unseen))
    expect(valueOf(await openTopic(engine.registry, unseen)).outcome).toBe('offline')
    expect(await watchValue(engine, topicAtom(unseen))((detail) => detail !== null, 'the header')).toMatchObject({ channel: { label: '#eng' }, messageCount: 0 })
    expect((await unseenList.until(() => true, 'the window')).order).toEqual([])
  })
})

it('history the first sync left out comes when asked: a searched reply in full on open, older Main pages once each', async () => {
  // 150 deploys from three weeks ago, before the quiet window the boot reads. The channel is read, so the
  // boot's page does not reach back to an older read pointer.
  const engine = await bootedEngine(engines, { initial: (fake) => {
    const start = fake.now() - 21 * DAY
    for (let i = 0; i < 150; i++) fake.workspace.post({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: `old deploy ${i}`, at: start + i * 60_000, silent: true })
    fake.markRead({ channel: 'C0DEPLOYS', ts: fake.messages('C0DEPLOYS').at(-1)!.ts })
    return fake.signIn()
  } })
  await quiet(engine)

  await step('a reply the discovery search stored is not shown as part of its thread; the open brings it in full, with its reactions', async () => {
    // The followed thread's view carries only its latest replies; the search stored this one without its 👍, and no page proves what is around it.
    const reply = engine.fake.messages('C0ENG').find((m) => m.text?.startsWith('We keep the old primary warm'))!
    const thread = `t:C0ENG:${reply.thread_ts}`
    const list = watchList(engine, messagesAtom(thread))
    await list.until((window) => window.order.length > 0 && !window.rows.has(reply.ts) && window.meta.gapBefore === true, 'the thread without the search match')
    expect(valueOf(await openTopic(engine.registry, thread)).outcome).toBe('fetched')
    const after = await list.until((window) => window.meta.windowCovered === true && window.rows.get(reply.ts)?.reactions.length === 1, 'the reply in full')
    expect(after.rows.get(reply.ts)!.reactions).toMatchObject([{ name: '+1', count: 2, me: true }])
  })

  const id = 'm:C0DEPLOYS'
  const bottom = await watchList(engine, messagesAtom(id)).until((window) => window.order.length === 6, 'the recent deploys')
  const first = bottom.order[0]!
  const wider = watchList(engine, messagesAtom(id, { anchor: first, before: 100, limit: 106 }))

  await step('scrolling up fetches the page before the window with one call', async () => {
    engine.fake.resetCalls()
    expect(valueOf(await loadOlderMessages(engine.registry, id, first))).toEqual({ outcome: 'fetched', complete: false })
    expect(opens(engine).map((call) => call.method)).toEqual(['conversations.history'])
  })

  await step('the widened window shows the hundred older rows before the ones it had', async () => {
    const window = await wider.until((value) => value.order.length === 106, 'the wider window')
    expect<unknown>(window.order.slice(100)).toEqual(bottom.order)
    expect(textOf(window.rows.get(window.order[0]!)!)).toBe('old deploy 50')
  })

  await step('the last fifty take one more call, which reaches the start; asking again is served from the store', async () => {
    const top = wider.current().order[0]!
    engine.fake.resetCalls()
    expect(valueOf(await loadOlderMessages(engine.registry, id, top))).toEqual({ outcome: 'fetched', complete: true })
    expect(valueOf(await loadOlderMessages(engine.registry, id, top))).toEqual({ outcome: 'cached', complete: true })
    expect(opens(engine)).toHaveLength(1)
  })
})

it('a jump to a reply deep in a long thread is one bounded read, however far it is past the stored replies', async () => {
  const engine = await synced()
  // Longer than one open fetches, posted with no events: the open stores steps 1 to 495 (every page of 100 holds the root).
  const now = engine.fake.now()
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Long rollout log', at: now - 2 * DAY, silent: true })
  const replies = Array.from({ length: 1150 }, (_, i) => engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${i + 1}`, threadTs: root.ts, at: now - 2 * DAY + (i + 1) * 1000, silent: true }))
  const id = `t:C0ENG:${root.ts}`
  expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
  const jump = async (index: number, before: number) => {
    const ts = replies[index]!.ts
    engine.fake.resetCalls()
    const { outcome } = valueOf(await loadMessageAt(engine.registry, id, ts))
    const window = await watchList(engine, messagesAtom(id, { anchor: ts, before, limit: before + 1 })).until((value) => value.rows.has(ts), `step ${index + 1}`)
    return { outcome, calls: opens(engine).map((call) => call.method), texts: rowsOf(window).map(textOf), covered: window.meta.windowCovered }
  }
  await step('a reply 600 past the stored ones takes two calls, and the stretch from it to the newest covers its window', async () => {
    expect(await jump(1099, 0)).toEqual({ outcome: 'fetched', calls: ['conversations.replies', 'conversations.replies'], texts: ['rollout step 1100'], covered: true })
  })
  await step('a reply within a page of the stored ones takes one call and brings every reply before it; one stored in full takes none', async () => {
    // The first jump's first page stored the steps up to 593.
    expect(await jump(639, 60)).toMatchObject({ outcome: 'fetched', calls: ['conversations.replies'], texts: replies.slice(579, 640).map((reply) => reply.text) })
    expect(await jump(520, 0)).toMatchObject({ outcome: 'cached', calls: [] })
  })
})

it('an image Slack had no thumbnail for becomes the picture: retried on reopen after its lookups ran out, and an old card on open', async () => {
  // The four lookups wait 1, 3, 10 and 30 times this.
  const engine = await syncedEngine(engines, { timing: { fileRetryMillis: 5 } })
  const { fake } = engine
  const lookups = (method: string) => apiCalls(engine, method).filter((call) => call.args['_x_reason'] === 'file')
  const image = (window: ListWindow<MessageView>, text: string) => rowsOf(window).find((row) => textOf(row) === text)?.files[0]

  await step('a fresh image is looked up four times, an open asks four times more, and the reopen after Slack made it brings the picture', async () => {
    const main = watchList(engine, messagesAtom('m:C0ENG'))
    fake.holdThumbnails()
    fake.resetCalls()
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Slow image processing', media: [{ name: 'late.png', width: 800, height: 600 }] })
    await main.until((window) => image(window, 'Slow image processing') !== undefined, 'the card')
    await waitFor(() => (lookups('conversations.history').length === 4 ? true : undefined), WAIT_MS, 'four lookups')
    // Opened while Slack still has no thumbnail: the open's page stores the message, and its lookups start again.
    valueOf(await openTopic(engine.registry, 'm:C0ENG'))
    await waitFor(() => (lookups('conversations.history').length === 8 ? true : undefined), WAIT_MS, 'four more lookups')
    // No message update or file event comes, and the next open's page starts after the message.
    fake.releaseThumbnails({ event: 'none' })
    await quiet(engine)
    expect(image(main.current(), 'Slow image processing')?.thumb).toBeUndefined()
    valueOf(await openTopic(engine.registry, 'm:C0ENG'))
    const window = await main.until((value) => image(value, 'Slow image processing')?.thumb !== undefined, 'the picture after the reopen')
    expect(image(window, 'Slow image processing')).toMatchObject({ kind: 'image', width: 800, height: 600 })
  })

  await step('an old card stored before Slack made its thumbnail becomes the picture through file info when its topic opens', async () => {
    // Two days old as it arrives, it is too old to be asked about then.
    fake.holdThumbnails()
    fake.resetCalls()
    fake.injectMedia({ channel: 'C0PRODUCT', user: 'U0LEO', text: 'The venue floor plan', ago: 2 * 24 * 60, media: [{ name: 'floor-plan.png', width: 800, height: 600 }] })
    fake.releaseThumbnails({ event: 'none' })
    await quiet(engine)
    expect(lookups('files.info')).toHaveLength(0)
    const product = watchList(engine, messagesAtom('m:C0PRODUCT'))
    valueOf(await openTopic(engine.registry, 'm:C0PRODUCT'))
    const window = await product.until((value) => image(value, 'The venue floor plan')?.thumb !== undefined, 'the picture after the open')
    expect(image(window, 'The venue floor plan')).toMatchObject({ kind: 'image', width: 800, height: 600 })
    expect(lookups('files.info').length).toBeGreaterThan(0)
    expect(lookups('files.info').every((call) => call.ok)).toBe(true)
    expect(lookups('conversations.history')).toHaveLength(0)
  })
})

it('a window is covered by a page that confirms it, even one that changes no message', async () => {
  const engine = await synced()

  await step('a Main window stored only from the socket is covered by a first page that brings nothing new', async () => {
    // An empty channel created after the boot: the store has no history range for it.
    engine.fake.workspace.addConversation({ id: 'C0QUIET', name: 'quiet', kind: 'public', members: new Set(['U0MAYA']), created: engine.fake.now() - DAY, topic: '', purpose: '', isOpen: true, archived: false })
    engine.fake.joinChannel({ channel: 'C0QUIET' })
    const message = engine.fake.injectMessage({ channel: 'C0QUIET', user: 'U0MAYA', text: 'Only seen on the socket' })
    const list = watchList(engine, messagesAtom('m:C0QUIET'))
    const before = await list.until((window) => window.rows.has(message.ts) && window.meta.windowCovered === false, 'the socket message, not yet covered')
    expect(valueOf(await openTopic(engine.registry, 'm:C0QUIET')).outcome).toBe('fetched')
    const after = await list.until((window) => window.meta.windowCovered === true, 'the window covered by the page')
    expect(after.rows.get(message.ts)).toBe(before.rows.get(message.ts)!)
  })

  await step('a thread window is covered by a replies page that changes no message', async () => {
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Thread with incomplete counters' })
    engine.fake.emitFrame({ type: 'message', subtype: 'message_replied', channel: 'C0ENG', message: { ts: root.ts, reply_count: 10 }, event_ts: root.ts })
    const id = `t:C0ENG:${root.ts}`
    const list = watchList(engine, messagesAtom(id))
    const before = await list.until((window) => window.rows.has(root.ts) && window.meta.windowCovered === false, 'the thread, not yet covered')
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    const after = await list.until((window) => window.meta.windowCovered === true, 'the thread covered by the page')
    expect(after.rows.get(root.ts)).toBe(before.rows.get(root.ts)!)
  })
})

it('live changes reach exactly the rows they touch, and names stand in for mentions', async () => {
  const engine = await synced()
  const thread = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
  const rootTs = tsOf(thread)
  valueOf(await openTopic(engine.registry, thread))
  const list = watchList(engine, messagesAtom(thread))
  await list.until((window) => window.order.length === 7, 'the root and six replies')
  const main = watchList(engine, messagesAtom('m:C0ENG'))

  await step('a reply from another client adds one row, in a small delta', async () => {
    const before = list.current()
    const reply = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', threadTs: rootTs, text: 'Cutover is a go' })
    const after = await list.until((window) => window.order.length === 8, 'the new reply')
    expect(changedRows(before, after)).toEqual([reply.ts])
    const row = after.rows.get(reply.ts)!
    expect(row).toMatchObject({ senderId: 'U0SAM', fromMe: false })
    expect(after.refs.people.get('U0SAM')?.name).toBe('Sam')
    expect(bytes([encodeMessage(row)])).toBeLessThan(32 * 1024)
  })

  await step('an edit, a reaction and a deleted root each change one row', async () => {
    const [, second, third] = list.current().order
    let before = list.current()
    engine.fake.editMessage({ channel: 'C0ENG', ts: second!, text: 'Four minutes is fine for us.' })
    let after = await list.until((window) => window.rows.get(second!)?.edited === true, 'the edit')
    expect<unknown>(changedRows(before, after)).toEqual([second])
    expect(textOf(after.rows.get(second!)!)).toBe('Four minutes is fine for us.')

    before = after
    engine.fake.addReaction({ channel: 'C0ENG', ts: third!, name: 'eyes', user: 'U0SAM' })
    after = await list.until((window) => window.rows.get(third!)?.reactions.some((r) => r.name === 'eyes') === true, 'the reaction')
    expect<unknown>(changedRows(before, after)).toEqual([third])
    expect(after.rows.get(third!)!.reactions.find((r) => r.name === 'eyes')).toEqual({ name: 'eyes', count: 1, me: false, unicode: '👀', users: ['U0SAM'] })

    before = after
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: rootTs })
    after = await list.until((window) => window.rows.get(rootTs)?.kind === 'deleted', 'the deleted root')
    expect(changedRows(before, after)).toEqual([rootTs])
    expect(after.order).toHaveLength(8)
    await main.until((window) => window.rows.get(rootTs)?.kind === 'deleted', 'the deleted root in Main')
  })

  await step("a reply to another thread changes only its root's row in Main", async () => {
    const other = tsOf(threadId(engine.fake, 'C0ENG', 'Unrelated: has anyone looked'))
    const before = await main.until((window) => window.rows.get(other)?.thread?.replyCount === 2, 'the thread link')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', threadTs: other, text: 'Reaper is merged.' })
    const after = await main.until((window) => window.rows.get(other)?.thread?.replyCount === 3, 'the new count')
    expect(changedRows(before, after)).toEqual([other])
  })

  await step("a person's new photo reaches the refs and changes no message row and no sidebar rev", async () => {
    const sidebar = await engine.rowsUntil((rows) => rows.some((row) => row.participants.some((p) => p.id === 'U0LEO')), 'a sidebar row with Leo')
    const sidebarBefore = new Map(sidebar.map((row) => [row.id, row]))
    const before = list.current()
    const leo = engine.fake.workspace.users.get('U0LEO')!
    const photo = `${engine.fake.url}/avatars/U0LEO-new.png`
    const updated = { ...leo, profile: { ...leo.profile, image_72: photo, image_48: `${photo}?size=48`, image_192: `${photo}?size=192` } }
    engine.fake.workspace.users.set('U0LEO', updated)
    engine.fake.workspace.emit({ type: 'user_change', user: updated } as Parameters<typeof engine.fake.workspace.emit>[0])
    const after = await list.until((window) => window.refs.people.get('U0LEO')?.avatarUrl === photo, 'the new photo in refs')
    expect(after.refs.people.get('U0LEO')).toMatchObject({ avatarSmallUrl: `${photo}?size=48`, avatarLargeUrl: `${photo}?size=192` })
    expect(changedRows(before, after)).toEqual([])
    // Rows that show Leo get the new photo with the same rev; the others keep their object.
    const shown = await engine.rowsUntil((rows) => rows.some((row) => row.participants.some((p) => p.id === 'U0LEO' && p.avatarUrl === photo)), 'the new photo in the sidebar')
    for (const row of shown) {
      expect<unknown>(row.rev).toBe(sidebarBefore.get(row.id)?.rev)
      if (![...row.participants, ...(row.channel.members ?? [])].some((p) => p.id === 'U0LEO')) expect<unknown>(row).toBe(sidebarBefore.get(row.id))
    }
  })

  await step('each bot message shows its own name and icon, and the sidebar names the latest', async () => {
    const at = Math.floor(engine.fake.now() / 1000)
    const messages = [
      { ts: `${at}.900001`, username: 'Release helper', bot_profile: { id: 'B0TEST', name: 'Build helper', icons: { image_72: 'https://example.test/build.png' } } },
      { ts: `${at}.900002`, bot_profile: { id: 'B0TEST', name: 'Build helper', icons: { image_48: 'https://example.test/other.png' } } },
    ]
    for (const message of messages) engine.fake.emitFrame({ type: 'message', channel: 'C0ENG', subtype: 'bot_message', bot_id: 'B0TEST', text: 'Synthetic build status', ...message })
    const window = await main.until((value) => messages.every((message) => value.rows.has(message.ts)), 'the bot messages')
    const senders = messages.map((message) => window.refs.people.get(window.rows.get(message.ts)!.senderId!))
    expect(senders).toMatchObject([{ name: 'Release helper', avatarUrl: 'https://example.test/build.png' }, { name: 'Build helper', avatarUrl: 'https://example.test/other.png' }])
    await engine.rowsUntil((rows) => rows.find((row) => row.id === 'm:C0ENG')?.preview.sender === 'Build helper', 'the bot in the preview')
  })

  await step('after joining a user group, mentions of it are marked yours and other groups stay plain', async () => {
    engine.fake.emitFrame({ type: 'subteam_self_added', subteam_id: 'S0PLATFORM' })
    const own = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0PLATFORM|@platform> Review this.' })
    const other = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0OTHER|@other> Review this.' })
    const window = await main.until((value) => value.rows.has(own.ts) && value.rows.has(other.ts), 'the group mentions')
    const group = (ts: string) => window.rows.get(ts)?.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).find((inline) => inline.kind === 'usergroup')
    expect([group(own.ts), group(other.ts)]).toMatchObject([{ id: 'S0PLATFORM', isMine: true }, { id: 'S0OTHER', isMine: false }])
  })

  await step('a mention and Slack escaping read as a name and plain text in the thread link and the Threads list', async () => {
    // Slack stores it as `<@U0DEV> fix the backend -&gt; github sync today`.
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<@U0DEV> fix the backend -> github sync today' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', threadTs: root.ts, text: 'On it.' })
    const window = await main.until((value) => value.rows.get(root.ts)?.thread?.replyCount === 1, 'the thread link')
    expect(window.rows.get(root.ts)!.thread!.preview).toBe('Dev: On it.')
    const listed = await watchList(engine, channelThreadsAtom('C0ENG')).until((value) => rowsOf(value).some((row) => row.rootTs === root.ts), 'the thread in the list')
    expect(rowsOf(listed).find((row) => row.rootTs === root.ts)!.title).toStartWith('@Dev fix the backend -> github')
  })

  await step('a Slack Connect person the edge first reports as pending is named on their join and their message', async () => {
    // As observed live: without Slack's flags the edge fails such a person every time; with them it says pending, then answers.
    const maya = engine.fake.workspace.users.get('U0MAYA')!
    engine.fake.workspace.addUser({ ...maya, id: 'U0PARTNER', team_id: 'T0PARTNER', name: 'ana', real_name: 'Ana Ruiz', profile: { ...maya.profile, display_name: 'Ana' } }, { profileOnly: { pendingAnswers: 1 } })
    const join = `${Math.floor(engine.fake.now() / 1000)}.800001`
    engine.fake.emitFrame({ type: 'message', channel: 'C0ENG', subtype: 'channel_join', user: 'U0PARTNER', ts: join, text: '<@U0PARTNER> has joined the channel' })
    const said = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0PARTNER', text: 'Hello from the partner team.' })
    const window = await main.until((value) => value.refs.people.get('U0PARTNER')?.name === 'Ana' && value.rows.has(join) && value.rows.has(said.ts), 'the partner named')
    const mention = window.rows.get(join)!.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).find((inline) => inline.kind === 'user')
    expect(mention).toMatchObject({ id: 'U0PARTNER', name: 'Ana' })
    expect(window.rows.get(said.ts)!.senderId).toBe('U0PARTNER')
  })

  await step('a person who arrives after the thread was stored retitles its cached sidebar row', async () => {
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: engine.fake.workspace.selfId, text: '<@U0LATE> review the release' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', threadTs: root.ts, text: 'Ready.' })
    const id = `t:C0ENG:${root.ts}`
    const before = await engine.rowsUntil((rows) => rows.some((row) => row.id === id && row.title === '@Someone review the release'), 'the title before the person arrives')
    const maya = engine.fake.workspace.users.get('U0MAYA')!
    engine.fake.emitFrame({ type: 'user_change', user: { ...maya, id: 'U0LATE', name: 'dev', profile: { ...maya.profile, display_name: 'Dev' } } })
    const after = await engine.rowsUntil((rows) => rows.some((row) => row.id === id && row.title === '@Dev review the release'), 'the title with the late name')
    expect(after.find((row) => row.id === id)!.rev).not.toBe(before.find((row) => row.id === id)!.rev)
  })
})

it("Main's thread link previews the first reply once the thread is opened, and names its first three repliers", async () => {
  const engine = await synced()
  const thread = threadId(engine.fake, 'C0ENG', 'checkout.spec failed again')
  const root = tsOf(thread)
  const main = watchList(engine, messagesAtom('m:C0ENG'))
  const link = (window: ListWindow<MessageView>) => window.rows.get(root)?.thread

  await step('before the thread is opened, the link has its count and no preview: Main never fetches replies', async () => {
    expect(link(await main.until((window) => link(window)?.replyCount === 5, 'the thread link'))?.preview).toBeUndefined()
  })

  await step('after the open, the link previews the first reply, not the root or the newest reply', async () => {
    expect(valueOf(await openTopic(engine.registry, thread)).outcome).toBe('fetched')
    const window = await main.until((value) => link(value)?.preview !== undefined, 'the preview')
    expect(link(window)).toMatchObject({ replyCount: 5, preview: 'Sam: Quarantining it. Ticket filed.', replierIds: ['U0SAM', 'U0DEV'] })
  })

  await step('new replies keep the first reply as the preview and add repliers up to three, in Slack order', async () => {
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', threadTs: root, text: 'I will check the frame load.' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', threadTs: root, text: 'I can take the ticket.' })
    const window = await main.until((value) => link(value)?.replyCount === 7, 'seven replies')
    expect(link(window)).toMatchObject({ preview: 'Sam: Quarantining it. Ticket filed.', replierIds: ['U0SAM', 'U0DEV', 'U0MAYA'] })
  })
})

it('a user group mention reads as its handle in Main, a thread and the sidebar, a deleted group keeps its name, and a rename reaches the open thread', async () => {
  const engine = await synced()
  const postgres = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
  valueOf(await openTopic(engine.registry, postgres))
  const thread = watchList(engine, messagesAtom(postgres))
  const main = watchList(engine, messagesAtom('m:C0ENG'))
  // Slack sends the bare id; the handle comes from `usergroups.list`.
  const old = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Old pager notes from <!subteam^S0OLDOPS> are archived.' })
  const design = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<!subteam^S0DESIGN> the new icons are ready for review.' })
  const ask = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', threadTs: tsOf(postgres), text: '<!subteam^S0PLATFORM> can someone review the cutover runbook?' })
  const group = (window: ListWindow<MessageView>, ts: string) => window.rows.get(ts)?.body.blocks.flatMap((block) => ('children' in block ? block.children : [])).find((inline) => inline.kind === 'usergroup')

  await step('Main names the group by its handle, and a deleted group by the handle it had', async () => {
    const window = await main.until((value) => value.rows.has(old.ts) && value.rows.has(design.ts), 'the mentions in Main')
    expect([group(window, design.ts), group(window, old.ts)]).toMatchObject([{ id: 'S0DESIGN', handle: 'design-crew', name: 'Design crew' }, { id: 'S0OLDOPS', handle: 'old-ops' }])
  })

  await step('the sidebar previews read the handle, never the id', async () => {
    const rows = await engine.rowsUntil((list) => list.find((row) => row.id === 'm:C0ENG')?.preview.text.startsWith('@design-crew the new icons') === true
      && list.find((row) => row.id === postgres)?.preview.text.startsWith('@platform can someone review') === true, 'the handles in the previews')
    expect(rows.filter((row) => /S0[A-Z]+/.test(`${row.title} ${row.preview.text}`)).map((row) => row.id)).toEqual([])
  })

  await step('the thread names it, and a rename from another client reaches it', async () => {
    expect(group(await thread.until((value) => value.rows.has(ask.ts), 'the mention in the thread'), ask.ts)).toMatchObject({ id: 'S0PLATFORM', handle: 'platform', name: 'Platform team' })
    engine.fake.putUsergroup({ id: 'S0PLATFORM', handle: 'platform-core', name: 'Platform core' })
    const renamed = await thread.until((value) => JSON.stringify(group(value, ask.ts)).includes('platform-core'), 'the new handle')
    expect(group(renamed, ask.ts)).toMatchObject({ handle: 'platform-core', name: 'Platform core' })
  })
})
