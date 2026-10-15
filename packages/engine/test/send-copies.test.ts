// Copies the network makes of a post (ADR 0014, specs/outbox.qnt): the
// copy's delete is checked again just before it goes out, and after a gap
// only once the recheck has read the copy's topic. Slack must always hold
// at least one copy of the post.
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageView } from '@juno/contract'
import { messagesAtom, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet, readDb, valueOf } from './scenario'

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

/** Sends `text` to #eng's Main and answers with the `client_msg_id` of the post that went to Slack. */
async function post(engine: RunningEngine, text: string): Promise<string> {
  const before = apiCalls(engine, 'chat.postMessage').length
  expect(valueOf(await sendMessage(engine.registry, eng, text, MAIN))).toEqual({ topicId: MAIN })
  return waitFor(() => apiCalls(engine, 'chat.postMessage')[before]?.args['client_msg_id'], WAIT_MS, `"${text}" posted`)
}

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

/** Copies of the message in Slack. */
const inSlack = (engine: RunningEngine, clientMsgId: string) => engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === clientMsgId).length

/** The window shows the message once, as Slack's, and nothing pending. */
const settled = (text: string) => (rows: ReadonlyArray<MessageView>) =>
  rows.filter((row) => textOf(row) === text).length === 1 && rows.some((row) => textOf(row) === text && row.pending === undefined)

// Review 2026-10-17 (docs/reviews/2026-10-17-correctness.md): the copy's delete is decided once, when the
// copy is stored, and is not checked again before it goes out. These fail while that holds.
describe('send: a copy whose delete waits', () => {
  /** A post the network sent twice, the copy's delete refused for its first `failures` tries. Answers both ts. */
  async function copyWithSlowDelete(engine: RunningEngine, text: string, failures: number) {
    engine.main.network.resend = true
    const rows = watch(engine, MAIN)
    await rows((list) => list.length > 0, 'the window')
    engine.fake.holdFrames({ types: ['message'] })
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const id = await post(engine, text)
    await rows(settled(text), 'the answer stored')
    const kept = readDb(engine, 'user.db', (db) => (db.prepare('SELECT ts FROM sent_posts WHERE client_msg_id = ?').get(id) as { ts: string }).ts)
    const copy = engine.fake.messages('C0ENG').find((m) => m.client_msg_id === id && m.ts !== kept)!.ts
    // Slack's own trouble: the delete is tried again with backoff (1 s, 2 s, 4 s).
    engine.fake.forceError({ method: 'chat.delete', error: 'internal_error', times: failures })
    engine.fake.releaseFrames()
    await waitFor(() => (apiCalls(engine, 'chat.delete').length > 0 ? true : undefined), WAIT_MS, 'the first delete refused')
    return { id, kept, copy, rows }
  }

  const deletesLeft = (engine: RunningEngine) =>
    readDb(engine, 'user.db', (db) => (db.prepare(`SELECT count(*) AS n FROM outbox WHERE kind = 'delete'`).get() as { n: number }).n)

  it('keeps a copy that another person replied to while its delete waited', async () => {
    const engine = await booted()
    const { copy } = await copyWithSlowDelete(engine, 'Copy that gets a reply', 3)
    // Other people's clients show both messages until the delete lands. Maya replies to the copy.
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Replying to the copy', threadTs: copy })
    await waitFor(
      () => (readDb(engine, 'cache.db', (db) => (db.prepare('SELECT reply_count AS n FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', copy) as { n: number } | undefined)?.n) === 1 ? true : undefined),
      WAIT_MS,
      'the reply stored',
    )
    await waitFor(() => (deletesLeft(engine) === 0 ? true : undefined), WAIT_MS, 'the delete row settled')
    // ADR 0014: "A copy that has replies is left alone."
    // In the fake, as in Slack, a deleted root with replies becomes a tombstone.
    expect(engine.fake.messages('C0ENG').find((m) => m.ts === copy)?.subtype).toBeUndefined()
  })

  it('keeps the copy when the user deletes the kept message from another device while the delete waits', async () => {
    const engine = await booted()
    const { id, kept } = await copyWithSlowDelete(engine, 'Deleted on the phone', 3)
    // On the phone the user sees two messages and deletes one of them: the one Juno kept.
    engine.fake.deleteMessage({ channel: 'C0ENG', ts: kept })
    await waitFor(
      () => (readDb(engine, 'cache.db', (db) => (db.prepare('SELECT deleted FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', kept) as { deleted: number } | undefined)?.deleted) !== 0 ? true : undefined),
      WAIT_MS,
      'the delete from the phone stored',
    )
    await waitFor(() => (deletesLeft(engine) === 0 ? true : undefined), WAIT_MS, 'the delete row settled')
    // The user meant to keep one message. Juno deleting the other leaves none.
    expect(inSlack(engine, id)).toBe(1)
  })
})

// A post sent before a gap may have had its kept message deleted during the gap, which no event reports.
/** A post the network sent twice, the copy's delete refused for its first `failures` tries. The caller drops the socket. */
async function copyAcrossDrop(engine: RunningEngine, text: string, failures: number) {
  engine.main.network.resend = true
  const rows = watch(engine, MAIN)
  await rows((list) => list.length > 0, 'the window')
  engine.fake.holdFrames({ types: ['message'] })
  engine.fake.loseResponse({ method: 'chat.postMessage' })
  const id = await post(engine, text)
  await rows(settled(text), 'the answer stored')
  engine.fake.forceError({ method: 'chat.delete', error: 'internal_error', times: failures })
  engine.fake.releaseFrames()
  await waitFor(() => (apiCalls(engine, 'chat.delete').length > 0 ? true : undefined), WAIT_MS, 'the first delete refused')
  return id
}

const keptCopy = (engine: RunningEngine) =>
  readDb(engine, 'user.db', (db) => db.prepare('SELECT reason, hidden FROM kept_copies').get() as { reason: string; hidden: number } | undefined)

describe('send: a copy whose delete waits across a reconnect', () => {
  it('keeps the copy when the recheck after the reconnect does not read its channel', async () => {
    const engine = await bootedEngine(engines, { recheckTopics: 0 })
    await quiet(engine)
    engine.fake.resetCalls()
    const id = await copyAcrossDrop(engine, 'Sent before the drop', 5)
    // Nothing on screen and no active topics to read: the recheck reads no topic.
    for (const unmount of unmounts.splice(0)) unmount()
    engine.fake.dropSocket()
    await waitFor(() => keptCopy(engine), WAIT_MS, 'the copy kept')
    expect(keptCopy(engine)).toEqual({ reason: 'not-rechecked', hidden: 0 })
    expect(readDb(engine, 'user.db', (db) => (db.prepare(`SELECT count(*) AS n FROM outbox WHERE kind = 'delete'`).get() as { n: number }).n)).toBe(0)
    expect(inSlack(engine, id)).toBe(2)
  })

  it('deletes the copy once the recheck after the reconnect has read its channel', async () => {
    const engine = await booted()
    const id = await copyAcrossDrop(engine, 'Sent before the drop, then rechecked', 2)
    engine.fake.dropSocket()
    await waitFor(() => (inSlack(engine, id) === 1 ? true : undefined), WAIT_MS, 'the copy deleted')
    expect(apiCalls(engine, 'conversations.history').some((call) => call.args['_x_reason'] === 'recheck' && call.args['channel'] === 'C0ENG')).toBe(true)
    expect(keptCopy(engine)).toBeUndefined()
  })
})
