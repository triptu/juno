// Read state end to end (architecture 5.6, specs/readstate.qnt): the read
// commands over the port, the sidebar rows they change, and what reaches
// the fake Slack.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prefsSet, readsCatchUp, readsMarkRead, readsMarkUnread, type TopicRow, type UndoCommand } from '@juno/contract'
import { mirrorReadsAtom, readCatchUpAtom, runCommand, type TopicListFilter } from '@juno/state'
import { sleep, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine as boot, quiet, readDb, restart, threadId, tsOf, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const bootedEngine = () => boot(engines)

const ALERTS = 'C0ALERTSPROD'
const ALERTS_MAIN = `m:${ALERTS}`

const markRead = (engine: RunningEngine, id: string, upTo?: string) => runCommand(engine.registry, readsMarkRead, upTo === undefined ? { id } : { id, upTo })
const markUnread = (engine: RunningEngine, id: string, from?: string) => runCommand(engine.registry, readsMarkUnread, from === undefined ? { id } : { id, from })
const replay = (engine: RunningEngine, undo: UndoCommand) =>
  undo._tag === 'reads.markRead' ? markRead(engine, undo.id, undo.upTo) : undo._tag === 'reads.markUnread' ? markUnread(engine, undo.id, undo.from) : undefined
const setMirror = (engine: RunningEngine, on: boolean) => runCommand(engine.registry, prefsSet, { key: 'reads.mirror', value: on })

/** Mark calls the fake received, in order. */
const marks = (engine: RunningEngine) => apiCalls(engine).filter((c) => c.method === 'conversations.mark' || c.method === 'subscriptions.thread.mark')

/** The sidebar row of a topic once `predicate` holds for it. */
/** The topic's channel, narrowed to: it shows even when a view keeps the channel out of All, as Automated does #alerts-prod. */
const scoped = (id: string): TopicListFilter => ({ kind: 'all', unreadOnly: false, scope: id.split(':')[1]! })

const rowWhen = async (engine: RunningEngine, id: string, predicate: (row: TopicRow) => boolean, label: string) =>
  (await engine.rowsUntil((rows) => rows.some((r) => r.id === id && predicate(r)), label, scoped(id))).find((r) => r.id === id)!

/** Juno's stored pointer for a topic. */
const storedPointer = (engine: RunningEngine, id: string) =>
  readDb(engine, 'user.db', (db) => (db.prepare('SELECT last_read_ts FROM topic_reads WHERE topic_id = ?').get(id) as { last_read_ts: string } | undefined)?.last_read_ts)

/** Main's latest message in the fake. */
const latestMain = (engine: RunningEngine, channel: string) => engine.fake.messages(channel).filter((m) => m.thread_ts === undefined || m.thread_ts === m.ts).at(-1)!.ts

describe('marking read', () => {
  it('Main: the row is read at once and one conversations.mark carries the latest message', async () => {
    const engine = await bootedEngine()
    // Exact: the boot's history page reached back to the read pointer.
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9 && r.unreadExact, 'nine unread, exactly')
    engine.fake.resetCalls()
    const result = valueOf(await markRead(engine, ALERTS_MAIN))
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 0, 'read')
    await waitFor(() => (marks(engine).length > 0 ? true : undefined), 10_000, 'the mark')
    await quiet(engine)
    expect(marks(engine).map((c) => [c.method, c.args['channel'], c.args['ts']])).toEqual([['conversations.mark', ALERTS, latestMain(engine, ALERTS)]])
    expect(engine.fake.workspace.reads.get(ALERTS)).toBe(latestMain(engine, ALERTS))
    // Its own echo changes nothing.
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)

    // The undo marks the nine unread again, here and in Slack.
    expect(result.undo?._tag).toBe('reads.markUnread')
    valueOf((await replay(engine, result.undo!))!)
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread again')
    const pointer = storedPointer(engine, ALERTS_MAIN)
    await waitFor(() => (engine.fake.workspace.reads.get(ALERTS) === pointer ? true : undefined), 10_000, 'the unread mark in Slack')
  })

  it('a followed thread gets subscriptions.thread.mark read=1; an unfollowed one stays local', async () => {
    const engine = await bootedEngine()
    const roadmap = threadId(engine.fake, 'C0PRODUCT', 'Proposal: cut offline mode')
    await rowWhen(engine, roadmap, (r) => r.unreadCount === 3, 'three unread')
    engine.fake.resetCalls()
    valueOf(await markRead(engine, roadmap))
    await rowWhen(engine, roadmap, (r) => r.unreadCount === 0, 'read')
    await waitFor(() => (marks(engine).length > 0 ? true : undefined), 10_000, 'the mark')
    const latestReply = engine.fake.workspace.replies('C0PRODUCT', tsOf(roadmap)).at(-1)!.ts
    expect(marks(engine).map((c) => [c.method, c.args['thread_ts'], c.args['ts'], c.args['read']])).toEqual([
      ['subscriptions.thread.mark', tsOf(roadmap), latestReply, '1'],
    ])
    expect(engine.fake.workspace.subscription('C0PRODUCT', tsOf(roadmap))?.lastRead).toBe(latestReply)

    // Not followed in Slack: Juno's own pointer moves, nothing is sent.
    const checkout = threadId(engine.fake, 'C0ENG', 'checkout.spec failed again')
    valueOf(await markUnread(engine, checkout))
    valueOf(await markRead(engine, checkout))
    await sleep(800)
    await quiet(engine)
    expect(marks(engine)).toHaveLength(1)
    expect(storedPointer(engine, checkout)).toBe(engine.fake.workspace.replies('C0ENG', tsOf(checkout)).at(-1)!.ts)
  })

  it('a thread marked unread from a reply sends read=0 from that reply', async () => {
    const engine = await bootedEngine()
    const roadmap = threadId(engine.fake, 'C0PRODUCT', 'Proposal: cut offline mode')
    valueOf(await markRead(engine, roadmap))
    await quiet(engine)
    engine.fake.resetCalls()
    const replies = engine.fake.workspace.replies('C0PRODUCT', tsOf(roadmap))
    const undo = valueOf(await markUnread(engine, roadmap, replies.at(-2)!.ts)).undo
    await rowWhen(engine, roadmap, (r) => r.unreadCount === 2, 'two unread')
    await waitFor(() => (marks(engine).length > 0 ? true : undefined), 10_000, 'the mark')
    expect(marks(engine).map((c) => [c.args['ts'], c.args['read']])).toEqual([[replies.at(-2)!.ts, '0']])
    expect(engine.fake.workspace.subscription('C0PRODUCT', tsOf(roadmap))?.lastRead).toBe(replies.at(-3)!.ts)
    // Undo marks it read again.
    expect(undo).toEqual({ _tag: 'reads.markRead', id: roadmap, upTo: replies.at(-1)!.ts })
  })
})

describe("Main's new threads", () => {
  it('counts the threads started since Main was last read; reading Main clears it', async () => {
    const engine = await bootedEngine()
    const engMain = 'm:C0ENG'
    // #eng was read up to the Postgres plan; the staging bill thread started after it.
    await rowWhen(engine, engMain, (r) => r.newThreads === 1, 'one new thread')
    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Load test results are in.' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Looking now.', threadTs: root.ts })
    await rowWhen(engine, engMain, (r) => r.newThreads === 2, 'two new threads')
    expect((await engine.rows()).filter((r) => r.kind === 'thread' && r.newThreads !== 0)).toEqual([])

    valueOf(await markRead(engine, engMain))
    await rowWhen(engine, engMain, (r) => r.newThreads === 0, 'no new threads once Main is read')
  })
})

describe('the outbox', () => {
  it('five marks in a row make one call with the last intent', async () => {
    // The app's 400 ms window is shorter than five commands take on a loaded machine (up to 1.2 s at
    // ten busy processes per core), and then a second call is right. A longer window keeps all five in one.
    const windowMillis = 3_000
    const engine = await boot(engines, { markDelayMillis: windowMillis })
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread')
    engine.fake.resetCalls()
    const started = Date.now()
    for (const mark of [markRead, markUnread, markRead, markUnread, markRead]) valueOf(await mark(engine, ALERTS_MAIN))
    expect(Date.now() - started, 'the five marks took longer than the window').toBeLessThan(windowMillis)
    expect(marks(engine)).toEqual([])
    await waitFor(() => (marks(engine).length > 0 ? true : undefined), 10_000, 'the mark')
    await sleep(800)
    await quiet(engine)
    expect(marks(engine).map((c) => c.args['ts'])).toEqual([latestMain(engine, ALERTS)])
  })

  it('a transient failure is retried and acknowledged', async () => {
    const engine = await bootedEngine()
    engine.fake.resetCalls()
    engine.fake.forceError({ method: 'conversations.mark', error: 'internal_error', times: 1 })
    valueOf(await markRead(engine, ALERTS_MAIN))
    await waitFor(() => (engine.fake.workspace.reads.get(ALERTS) === latestMain(engine, ALERTS) ? true : undefined), 20_000, 'the mark in Slack')
    await quiet(engine)
    expect(marks(engine).map((c) => c.ok)).toEqual([false, true])
    expect(readDb(engine, 'user.db', (db) => db.prepare("SELECT count(*) AS n FROM outbox WHERE kind = 'mark'").get())).toEqual({ n: 0 })
  })

  it('a mark Slack has not acknowledged survives a restart and is sent after it', async () => {
    const first = await bootedEngine()
    first.fake.force429({ method: 'conversations.mark', retryAfter: 60, times: 10 })
    valueOf(await markRead(first, ALERTS_MAIN))
    await waitFor(() => (marks(first).length > 0 ? true : undefined), 10_000, 'the refused mark')
    const engine = await restart(engines, first, (fake) => fake.clear429({ method: 'conversations.mark' }))
    await waitFor(() => (engine.fake.workspace.reads.get(ALERTS) === latestMain(engine, ALERTS) ? true : undefined), 20_000, 'the mark after the restart')
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
  })
})

describe('marks from other clients (specs/readstate.qnt)', () => {
  it('an older channel_marked during a pending mark changes nothing', async () => {
    const engine = await bootedEngine()
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread')
    const messages = engine.fake.messages(ALERTS)
    engine.fake.holdNext({ method: 'conversations.mark' })
    const pending = markRead(engine, ALERTS_MAIN)
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.mark' }) === 1 ? true : undefined), 10_000, 'the held mark')
    // A frame stamped before Juno's mark, from another client that had read three messages.
    engine.fake.emitFrame({ type: 'channel_marked', channel: ALERTS, ts: messages.at(-7)!.ts, event_ts: messages.at(-1)!.ts })
    await sleep(300)
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
    engine.fake.release()
    valueOf(await pending)
    await sleep(500)
    await quiet(engine)
    // Slack, asked afterwards, has Juno's mark.
    expect(storedPointer(engine, ALERTS_MAIN)).toBe(latestMain(engine, ALERTS))
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
  })

  it('a newer official mark during a pending mark is kept and applies after the acknowledgement', async () => {
    const engine = await bootedEngine()
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread')
    const messages = engine.fake.messages(ALERTS)
    engine.fake.holdNext({ method: 'conversations.mark' })
    valueOf(await markRead(engine, ALERTS_MAIN))
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.mark' }) === 1 ? true : undefined), 10_000, 'the held mark')
    // Slack accepted Juno's mark; then the user marks two messages unread on their phone.
    engine.fake.markRead({ channel: ALERTS, ts: messages.at(-3)!.ts })
    await sleep(300)
    // The mark is still pending, so its intent stays visible.
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
    engine.fake.release()
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 2, 'the phone’s mark')
    expect(storedPointer(engine, ALERTS_MAIN)).toBe(messages.at(-3)!.ts)
  })

  it('an official mark arriving after Juno’s own, from before it, does not undo it', async () => {
    const engine = await bootedEngine()
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread')
    const messages = engine.fake.messages(ALERTS)
    engine.fake.holdFrames({ types: ['channel_marked'] })
    // Another client marks three read; its frame is delayed. Juno then marks all read and Slack never echoes it.
    engine.fake.markRead({ channel: ALERTS, ts: messages.at(-7)!.ts })
    valueOf(await markRead(engine, ALERTS_MAIN))
    await waitFor(() => (engine.fake.workspace.reads.get(ALERTS) === latestMain(engine, ALERTS) ? true : undefined), 10_000, 'the mark in Slack')
    await quiet(engine)
    engine.fake.resetCalls()
    engine.fake.releaseFrames({ count: 1 })
    engine.fake.releaseFrames({ drop: true })
    await sleep(500)
    await quiet(engine)
    // The frame cannot be ordered against Juno's mark, so Slack was asked; it still has Juno's mark.
    expect(apiCalls(engine, 'conversations.info').map((c) => c.args['channel'])).toContain(ALERTS)
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
  })
})

describe('the mirror setting', () => {
  it('is on against the fake; off, marks stay in Juno, also through a reconnect', async () => {
    const engine = await bootedEngine()
    const unmount = engine.registry.mount(mirrorReadsAtom)
    await waitFor(() => {
      const result = engine.registry.get(mirrorReadsAtom)
      return result._tag === 'Success' && result.value.on && !result.value.explicit ? true : undefined
    }, 10_000, 'the default setting')
    valueOf(await setMirror(engine, false))
    await waitFor(() => {
      const result = engine.registry.get(mirrorReadsAtom)
      return result._tag === 'Success' && !result.value.on && result.value.explicit ? true : undefined
    }, 10_000, 'the setting off')
    unmount()
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 9, 'nine unread')
    engine.fake.resetCalls()
    valueOf(await markRead(engine, ALERTS_MAIN))
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 0, 'read in Juno')
    // A reconnect reads counts again: Slack's pointer has not changed, so Juno's own mark stays.
    engine.fake.dropSocket()
    await engine.phase('live', 30_000)
    await waitFor(() => (apiCalls(engine, 'client.counts').length > 0 ? true : undefined), 20_000, 'the reconnect counts')
    await quiet(engine)
    expect(marks(engine)).toEqual([])
    expect((await engine.rows(scoped(ALERTS_MAIN))).find((r) => r.id === ALERTS_MAIN)?.unreadCount).toBe(0)
    // A change in Slack still applies.
    engine.fake.markRead({ channel: ALERTS, ts: engine.fake.messages(ALERTS).at(-2)!.ts })
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 1, 'Slack’s change')
  })
})

describe('nothing marks by itself', () => {
  it('a boot, live messages and a reconnect send no mark', async () => {
    const engine = await bootedEngine()
    engine.fake.injectMessage({ channel: ALERTS, user: 'U0GRAFANA', text: '[FIRING] cpu 90% on api-1' })
    await rowWhen(engine, ALERTS_MAIN, (r) => r.unreadCount === 10, 'ten unread')
    engine.fake.dropSocket()
    await engine.phase('live', 30_000)
    await quiet(engine)
    expect(marks(engine)).toEqual([])
  })
})


describe('read catch-up', () => {
  it('queues only earlier local reads, once, through the mark worker', async () => {
    const engine = await bootedEngine()
    valueOf(await setMirror(engine, false))
    const roadmap = threadId(engine.fake, 'C0PRODUCT', 'Proposal: cut offline mode')
    const checkout = threadId(engine.fake, 'C0ENG', 'checkout.spec failed again')
    valueOf(await markRead(engine, ALERTS_MAIN))
    valueOf(await markRead(engine, roadmap))
    valueOf(await markRead(engine, checkout))
    valueOf(await markUnread(engine, 'm:C0ENG'))
    await quiet(engine)
    expect(marks(engine)).toHaveLength(0)
    valueOf(await setMirror(engine, true))
    const unmount = engine.registry.mount(readCatchUpAtom)
    await waitFor(() => {
      const state = engine.registry.get(readCatchUpAtom)
      return state._tag === 'Success' && state.value.available === 2 ? true : undefined
    }, 10_000, 'two eligible earlier reads')
    engine.fake.resetCalls()
    valueOf(await runCommand(engine.registry, readsCatchUp, undefined))
    await waitFor(() => marks(engine).length === 2 ? true : undefined, 15_000, 'both catch-up marks')
    await waitFor(() => {
      const state = engine.registry.get(readCatchUpAtom)
      return state._tag === 'Success' && state.value.pending === 0 && state.value.available === 0 ? true : undefined
    }, 10_000, 'catch-up finished')
    expect(engine.fake.workspace.reads.get(ALERTS)).toBe(storedPointer(engine, ALERTS_MAIN))
    expect(engine.fake.workspace.subscription('C0PRODUCT', tsOf(roadmap))?.lastRead).toBe(storedPointer(engine, roadmap))
    valueOf(await runCommand(engine.registry, readsCatchUp, undefined))
    await quiet(engine)
    expect(marks(engine)).toHaveLength(2)
    unmount()
  })

  it('catches up an existing install with an unset preference once across restarts', async () => {
    const first = await bootedEngine()
    valueOf(await setMirror(first, false))
    valueOf(await markRead(first, ALERTS_MAIN))
    const pointer = storedPointer(first, ALERTS_MAIN)
    const next = await restart(engines, first, () => {
      // Reproduce the pre-migration install while its engine is stopped.
      const db = new DatabaseSync(join(first.userData, 'workspaces', first.fake.workspace.team.id, 'user.db'))
      try {
        db.prepare("DELETE FROM prefs WHERE key IN ('reads.mirror', 'reads.mirrorDefaultApplied', 'reads.mirrorCatchUp')").run()
      } finally { db.close() }
    })
    await waitFor(() => next.fake.workspace.reads.get(ALERTS) === pointer ? true : undefined, 15_000, 'automatic migration')
    expect(marks(next)).toHaveLength(1)
    const again = await restart(engines, next)
    await quiet(again)
    expect(marks(again)).toHaveLength(0)
  })
})
