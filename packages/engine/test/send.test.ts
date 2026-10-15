// Sending through the outbox (M6; architecture 5.7, specs/outbox.qnt): the
// pending row shows at once, and the answer, the socket echo, a page and the
// lookup after a lost answer reconcile it in every order, with Slack holding
// exactly one copy of each message.
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageView } from '@juno/contract'
import { discardMessage, draftAtom, messagesAtom, retryMessage, saveDraft, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, errorOf, quiet, readDb, restart, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const MAIN = 'm:C0ENG'
const eng = { kind: 'channel', channelId: 'C0ENG' } as const

const booted = async () => {
  const engine = await bootedEngine(engines)
  await quiet(engine)
  engine.fake.resetCalls()
  return engine
}

/** The topic's message window, mounted, read until `predicate` holds. */
function watch(engine: RunningEngine, topicId: string) {
  const atom = messagesAtom(topicId)
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<MessageView> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  return (predicate: (rows: ReadonlyArray<MessageView>) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      const rows = window?.order.map((id) => window.rows.get(id)!)
      return rows !== undefined && predicate(rows) ? rows : undefined
    }, WAIT_MS, label)
}

/** Sends `text` to #eng's Main and answers with its `client_msg_id`, from the pending row. */
async function send(engine: RunningEngine, text: string, rows: ReturnType<typeof watch>): Promise<string> {
  const exit = await sendMessage(engine.registry, eng, text, MAIN)
  expect(valueOf(exit)).toEqual({ topicId: MAIN })
  const shown = await rows((list) => list.some((row) => row.pending !== undefined && textOf(row) === text), `"${text}" shown`)
  return shown.find((row) => textOf(row) === text)!.clientMsgId!
}

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

/** Copies of the message in Slack. */
const inSlack = (engine: RunningEngine, clientMsgId: string) => engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === clientMsgId).length
/** Copies of the message in the store, and whether its pending row is left. */
const inStore = (engine: RunningEngine, clientMsgId: string) => ({
  stored: readDb(engine, 'cache.db', (db) => (db.prepare('SELECT count(*) AS n FROM messages WHERE client_msg_id = ?').get(clientMsgId) as { n: number }).n),
  pending: readDb(engine, 'user.db', (db) => (db.prepare('SELECT state FROM pending_messages WHERE client_msg_id = ?').get(clientMsgId) as { state: string } | undefined)?.state),
})

/** The window shows the message once, as Slack's, and nothing pending. */
const settled = (text: string) => (rows: ReadonlyArray<MessageView>) =>
  rows.filter((row) => textOf(row) === text).length === 1 && rows.some((row) => textOf(row) === text && row.pending === undefined)

describe('send', () => {
  it('shows the pending row at once, then the answer before the echo replaces it with one message', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    const id = await send(engine, 'Shipping the fix today', rows)
    expect(inStore(engine, id)).toEqual({ stored: 0, pending: 'sending' })
    engine.fake.release()
    await rows(settled('Shipping the fix today'), 'the answer stored')
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    engine.fake.releaseFrames()
    await quiet(engine)
    expect((await rows(settled('Shipping the fix today'), 'still one row')).filter((row) => textOf(row) === 'Shipping the fix today')).toHaveLength(1)
    expect(inSlack(engine, id)).toBe(1)
    const posts = apiCalls(engine, 'chat.postMessage')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.args['client_msg_id']).toBe(id)
  })

  it('lets the echo reconcile before the answer, and the late answer changes nothing', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdNext({ method: 'chat.postMessage' })
    valueOf(await sendMessage(engine.registry, eng, 'Echo first', MAIN))
    // Slack has run the call and its echo is out; the answer waits.
    const [held] = await waitFor(() => (engine.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? engine.fake.heldCalls({ method: 'chat.postMessage' }) : undefined), WAIT_MS, 'the held answer')
    const id = String(held!['client_msg_id'])
    await rows(settled('Echo first'), 'the echo stored')
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    engine.fake.release()
    await quiet(engine)
    await rows(settled('Echo first'), 'still one row')
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    expect(inSlack(engine, id)).toBe(1)
  })

  it('after a lost answer, finds the message in history instead of posting it again', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await send(engine, 'Lost answer', rows)
    await rows(settled('Lost answer'), 'the lookup stored it')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
    expect(apiCalls(engine, 'conversations.history').some((call) => call.args['oldest'] !== undefined)).toBe(true)
    engine.fake.releaseFrames()
    await quiet(engine)
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    expect(inSlack(engine, id)).toBe(1)
  })

  it('posts again when the lookup shows Slack never ran the call', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    // An internal_error may come after Slack ran the call, so it is unknown, not a refusal.
    engine.fake.forceError({ method: 'chat.postMessage', error: 'internal_error' })
    const id = await send(engine, 'Second try', rows)
    await rows(settled('Second try'), 'posted on the second try')
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(2)
    expect(inSlack(engine, id)).toBe(1)
  })

  it('reconciles from the catch-up page when the answer is lost and the socket drops', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await send(engine, 'Across a reconnect', rows)
    await waitFor(() => (inSlack(engine, id) === 1 ? true : undefined), WAIT_MS, 'Slack has it')
    engine.fake.releaseFrames({ drop: true })
    engine.fake.dropSocket()
    await engine.phase('live', 30_000)
    await rows(settled('Across a reconnect'), 'reconciled after the reconnect')
    await quiet(engine)
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    expect(inSlack(engine, id)).toBe(1)
    expect(apiCalls(engine, 'chat.postMessage')).toHaveLength(1)
  })

  it('looks a post up after a restart cut its answer off, and never posts it twice', async () => {
    const first = await booted()
    const rows = watch(first, MAIN)
    await rows((list) => list.length > 0, 'the window')
    first.fake.holdFrames({ types: ['message'] })
    first.fake.holdNext({ method: 'chat.postMessage' })
    const id = await send(first, 'Before the restart', rows)
    await waitFor(() => (first.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? true : undefined), WAIT_MS, 'the held answer')
    for (const unmount of unmounts.splice(0)) unmount()
    const engine = await restart(engines, first, (fake) => {
      fake.releaseFrames({ drop: true })
      fake.release()
    })
    await watch(engine, MAIN)(settled('Before the restart'), 'stored after the restart')
    await quiet(engine)
    // The held call answered into the stopped engine; the new one looked the post up and never sent it again.
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    expect(inSlack(engine, id)).toBe(1)
  })

  it('shows a refused send as failed; Retry posts it and Delete draft removes it', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 2 })
    const kept = await send(engine, 'Try me again', rows)
    const dropped = await send(engine, 'Throw me away', rows)
    await rows((list) => list.filter((row) => row.pending === 'failed').length === 2, 'both failed')
    expect(inStore(engine, kept).pending).toBe('failed')

    expect(valueOf(await retryMessage(engine.registry, kept))).toBeUndefined()
    await rows(settled('Try me again'), 'the retry posted it')
    expect(valueOf(await discardMessage(engine.registry, dropped))).toBeUndefined()
    await rows((list) => !list.some((row) => textOf(row) === 'Throw me away'), 'the draft deleted')
    expect(inSlack(engine, kept)).toBe(1)
    expect(inSlack(engine, dropped)).toBe(0)
    expect(errorOf(await discardMessage(engine.registry, kept))?._tag).toBe('NotFound')
  })

  it('posts a channel’s messages in the order they were sent', async () => {
    const engine = await booted()
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdNext({ method: 'chat.postMessage', before: true })
    const texts = ['First', 'Second', 'Third']
    for (const text of texts) await send(engine, text, rows)
    engine.fake.release()
    await rows((list) => texts.every((text) => settled(text)(list)), 'all three posted')
    const posted = apiCalls(engine, 'chat.postMessage').map((call) => call.args['text'])
    expect(posted).toEqual(texts)
  })

  it('flushes when a catch-up ends: a lookup waiting out its backoff runs at once', async () => {
    const engine = await booted()
    // A reply, so the catch-up's history pages cannot reconcile it: only the lookup can.
    const root = engine.fake.messages('C0ENG').find((m) => (m.reply_count ?? 0) > 0)!
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    // The lookup's client retries transient errors itself, so each failed lookup takes several of these.
    engine.fake.forceError({ method: 'conversations.replies', error: 'internal_error', times: 100 })
    valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'After the flush'))
    const post = await waitFor(() => apiCalls(engine, 'chat.postMessage')[0], WAIT_MS, 'the post')
    const id = String(post.args['client_msg_id'])
    const nextAt = () => readDb(engine, 'user.db', (db) => (db.prepare('SELECT next_at FROM pending_messages WHERE client_msg_id = ?').get(id) as { next_at: number } | undefined)?.next_at)
    // Each failed lookup doubles the wait; stop once the next one is far off.
    const due = await waitFor(() => {
      const at = nextAt()
      return at !== undefined && at - Date.now() > 10_000 ? at : undefined
    }, 90_000, 'a long backoff')
    engine.fake.clearError({ method: 'conversations.replies' })
    engine.fake.releaseFrames({ drop: true })
    engine.fake.dropSocket()
    await engine.phase('live', 30_000)
    await waitFor(() => (inStore(engine, id).pending === undefined ? true : undefined), WAIT_MS, 'settled after the catch-up')
    expect(Date.now()).toBeLessThan(due)
    expect(inStore(engine, id)).toEqual({ stored: 1, pending: undefined })
    expect(engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === id)).toHaveLength(1)
  })

  it('posts in a thread', async () => {
    const engine = await booted()
    const root = engine.fake.messages('C0ENG').find((m) => (m.reply_count ?? 0) > 0)!
    const topic = `t:C0ENG:${root.ts}`
    const rows = watch(engine, topic)
    await rows((list) => list.length > 0, 'the thread')
    const exit = await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Thursday works for me', topic)
    expect(valueOf(exit)).toEqual({ topicId: topic })
    await rows(settled('Thursday works for me'), 'the reply posted')
    expect(apiCalls(engine, 'chat.postMessage')[0]!.args['thread_ts']).toBe(root.ts)
  })

  it('opens a DM with conversations.open for a person never messaged, then posts', async () => {
    const engine = await booted()
    const { topicId } = valueOf(await sendMessage(engine.registry, { kind: 'person', userId: 'U0JONAS' }, 'Welcome aboard'))
    const opens = apiCalls(engine, 'conversations.open')
    expect(opens).toHaveLength(1)
    expect(opens[0]!.args['users']).toBe('U0JONAS')
    await watch(engine, topicId)(settled('Welcome aboard'), 'the DM posted')
    expect(apiCalls(engine, 'chat.postMessage')[0]!.args['channel']).toBe(topicId.slice('m:'.length))
  })

  it('keeps a draft per topic across a restart, and sending clears it', async () => {
    const first = await booted()
    expect(valueOf(await saveDraft(first.registry, MAIN, 'Half a thought'))).toBeUndefined()
    const engine = await restart(engines, first)
    const atom = draftAtom(MAIN)
    unmounts.push(engine.registry.mount(atom))
    const draft = () => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' ? result.value : undefined
    }
    await waitFor(() => (draft() === 'Half a thought' ? true : undefined), WAIT_MS, 'the draft back')
    valueOf(await sendMessage(engine.registry, eng, 'Half a thought, finished', MAIN))
    await waitFor(() => (draft() === '' ? true : undefined), WAIT_MS, 'the draft cleared')
  })
})
