// Which replies of a thread the store holds (architecture 5.5 and 5.6, specs/thread-coverage.qnt), against the
// fake Slack: only pages prove replies continuous, a thread window stops at the first boundary none proves and
// fills it as the view scrolls there, socket replies never stand in for a page, and a thread's unread count is
// exact only when a proven range reaches back to its read pointer.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { MESSAGE_WINDOW_MAX, type MessageView } from '@juno/contract'
import type { FakeSlack } from '@juno/fake-slack'
import { loadMessageAt, loadNewerMessages, loadOlderMessages, messagesAtom, openTopic, type ListWindow, type MessageWindowSpec } from '@juno/state'
import { afterEach, expect, it } from 'bun:test'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { apiCalls, bootedEngine, DAY, quiet, readDb, restart, seedThread, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** The calls the topic's commands made; other work runs on its own reasons. */
const opens = (engine: RunningEngine) => apiCalls(engine).filter((call) => call.args['_x_reason'] === 'open')

const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

/** A window of `id` once `predicate` holds for it. */
async function windowOf(engine: RunningEngine, id: string, spec: MessageWindowSpec, predicate: (window: ListWindow<MessageView>) => boolean, label: string) {
  const atom = messagesAtom(id, spec)
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 && predicate(result.value) ? result.value : undefined
  }, WAIT_MS, label)
}

const texts = (window: ListWindow<MessageView>) => window.order.map((id) => textOf(window.rows.get(id)!))

/** The step numbers a window of "rollout step N" rows shows, in order. */
const steps = (window: ListWindow<MessageView>) => texts(window).map((text) => Number(/rollout step (\d+)/.exec(text)?.[1] ?? 0))

/** Every number from the first to the last, once each: no reply missing between rows. */
const consecutive = (numbers: ReadonlyArray<number>) => numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1)

/** A long thread posted with no events, one reply a second, so the store knows nothing of it. */
function longThread(fake: FakeSlack, replies: number) {
  const now = fake.now()
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Long rollout log', at: now - 2 * DAY, silent: true })
  const posted = Array.from({ length: replies }, (_, i) =>
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${i + 1}`, threadTs: root.ts, at: now - 2 * DAY + (i + 1) * 1000, silent: true }))
  return { id: `t:C0ENG:${root.ts}`, root, replies: posted }
}

const indexRow = (engine: RunningEngine, id: string) =>
  readDb(engine, 'cache.db', (db) => db.prepare('SELECT unread_count, unread_exact FROM topic_index WHERE topic_id = ?').get(id)) as { unread_count: number; unread_exact: number } | undefined

it('a jump deep into a 1,200-reply thread, then scrolling up and down, closes the hole a step at a time with no reply missing', async () => {
  const engine = await syncedEngine(engines)
  const thread = longThread(engine.fake, 1200)
  // The open stores steps 1 to 495 (every page of 100 holds the root); the jump, 594 to 1099 stay unknown.
  expect(valueOf(await openTopic(engine.registry, thread.id)).outcome).toBe('fetched')
  const target = thread.replies[1099]!.ts

  await step('the jump is at most two calls, and its window stops at the hole rather than running across it', async () => {
    engine.fake.resetCalls()
    expect(valueOf(await loadMessageAt(engine.registry, thread.id, target)).outcome).toBe('fetched')
    expect(opens(engine)).toHaveLength(2)
    const window = await windowOf(engine, thread.id, { anchor: target, before: 50, limit: 150 }, (value) => value.order.includes(target), 'the jump window')
    expect(steps(window)[0]).toBe(1100)
    expect(consecutive(steps(window))).toBe(true)
    expect(window.meta.gapBefore).toBe(true)
  })

  await step('each step up is one or two calls and grows the window only by replies that join it', async () => {
    let first: string = target
    let calls = 0
    for (let round = 0; round < 40 && first !== thread.root.ts; round++) {
      engine.fake.resetCalls()
      valueOf(await loadOlderMessages(engine.registry, thread.id, first))
      const made = opens(engine).length
      expect(made).toBeLessThanOrEqual(2)
      calls += made
      const window = await windowOf(engine, thread.id, { anchor: first, before: 100, limit: 200 }, (value) => value.order.includes(first), `step ${round + 1}`)
      const numbers = steps(window).filter((n) => n > 0)
      expect(consecutive(numbers)).toBe(true)
      first = window.order[0]!
    }
    expect(first).toBe(thread.root.ts)
    expect(calls).toBeLessThanOrEqual(8)
  })

  await step('from the root to the jump every reply is there once, in order', async () => {
    const window = await windowOf(engine, thread.id, { anchor: thread.root.ts, before: 0, limit: MESSAGE_WINDOW_MAX }, (value) => value.order.length === MESSAGE_WINDOW_MAX, 'the thread from its root')
    expect(window.meta.gapBefore).toBeUndefined()
    expect(steps(window).slice(1)).toEqual(Array.from({ length: MESSAGE_WINDOW_MAX - 1 }, (_, i) => i + 1))
    const stored = readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages WHERE channel = ? AND thread_ts = ? AND ts <> thread_ts AND ts <= ?').get('C0ENG', thread.root.ts, target)) as { n: number }
    expect(stored.n).toBe(1100)
  })

  await step('scrolling down past the jump brings the last replies in one call', async () => {
    const last = thread.replies[1197]!.ts
    const before = await windowOf(engine, thread.id, { anchor: last, before: 0, limit: 10 }, (value) => value.order.includes(last), 'the end of the jump page')
    expect(before.meta.gapAfter).toBe(true)
    engine.fake.resetCalls()
    expect(valueOf(await loadNewerMessages(engine.registry, thread.id, last))).toEqual({ outcome: 'fetched', complete: true })
    expect(opens(engine)).toHaveLength(1)
    const after = await windowOf(engine, thread.id, { anchor: last, before: 0, limit: 10 }, (value) => value.order.length === 3, 'the last replies')
    expect(steps(after)).toEqual([1198, 1199, 1200])
    expect(after.meta.gapAfter).toBeUndefined()
  })
})

it('replies arriving live during a jump never make the thread look complete', async () => {
  const engine = await syncedEngine(engines)
  const thread = longThread(engine.fake, 1200)
  expect(valueOf(await openTopic(engine.registry, thread.id)).outcome).toBe('fetched')
  const target = thread.replies[1099]!.ts

  await step('three replies land on the socket while the jump waits for Slack', async () => {
    await quiet(engine)
    engine.fake.holdNext({ method: 'conversations.replies', reason: 'open' })
    const jump = loadMessageAt(engine.registry, thread.id, target)
    await waitFor(() => (engine.fake.heldCount({ method: 'conversations.replies' }) === 1 ? true : undefined), WAIT_MS, 'the held jump page')
    for (const text of ['live 1', 'live 2', 'live 3']) engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text, threadTs: thread.root.ts })
    await engine.socketIdle()
    engine.fake.release()
    expect(valueOf(await jump).outcome).toBe('fetched')
  })

  await step('the bottom shows only the live replies, not the stretch below the hole, and the count is not exact', async () => {
    const bottom = await windowOf(engine, thread.id, { limit: 150 }, (value) => texts(value).at(-1) === 'live 3', 'the live replies')
    expect(texts(bottom).every((text) => text.startsWith('live'))).toBe(true)
    expect(bottom.meta.gapBefore).toBe(true)
    expect(bottom.meta.windowCovered).toBe(false)
    expect(indexRow(engine, thread.id)?.unread_exact).toBe(0)
  })

  await step('scrolling up from the live replies asks Slack instead of trusting the count, and one call joins them to the jump', async () => {
    const first = (await windowOf(engine, thread.id, { limit: 150 }, (value) => value.order.length > 0, 'the bottom')).order[0]!
    engine.fake.resetCalls()
    expect(valueOf(await loadOlderMessages(engine.registry, thread.id, first)).outcome).toBe('fetched')
    expect(opens(engine)).toHaveLength(1)
    const window = await windowOf(engine, thread.id, { limit: 150 }, (value) => texts(value).includes('rollout step 1100'), 'the replies down to the jump')
    expect(texts(window).slice(-5)).toEqual(['rollout step 1199', 'rollout step 1200', 'live 1', 'live 2', 'live 3'])
    expect(steps(window).filter((n) => n > 0)).toEqual(Array.from({ length: 101 }, (_, i) => i + 1100))
    expect(window.meta.gapBefore).toBe(true)
  })
})

it('after a drop a followed thread keeps an exact unread count and an unfollowed one shows a dot until it is opened', async () => {
  let followed = ''
  let unfollowed = ''
  const engine = await bootedEngine(engines, { initial: (fake) => {
    followed = seedThread(fake, { channel: 'C0ENG', text: 'Followed rollout', ago: 60 * 60_000, replies: [50, 40].map((m) => m * 60_000), follow: true, unread: 1 }).id
    unfollowed = seedThread(fake, { channel: 'C0ENG', text: 'Unfollowed rollout', ago: 60 * 60_000, replies: [50, 40].map((m) => m * 60_000), follow: false }).id
    return fake.signIn()
  } })
  const rootOf = (id: string) => id.split(':')[2]!

  await step('live replies keep both counts exact', async () => {
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Followed rollout live', threadTs: rootOf(followed) })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Unfollowed rollout live', threadTs: rootOf(unfollowed) })
    await quiet(engine)
    expect(indexRow(engine, followed)).toEqual({ unread_count: 2, unread_exact: 1 })
    expect(indexRow(engine, unfollowed)).toEqual({ unread_count: 1, unread_exact: 1 })
  })

  await step('a reply to each while the socket is down: the followed thread counts it, the unfollowed one cannot', async () => {
    engine.fake.goOffline()
    await engine.phase('offline')
    for (const id of [followed, unfollowed]) engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Missed while down', threadTs: rootOf(id) as never, silent: true })
    engine.fake.goOnline()
    await engine.phase('live', 30_000)
    await quiet(engine)
    expect(indexRow(engine, followed)).toEqual({ unread_count: 3, unread_exact: 1 })
    expect(indexRow(engine, unfollowed)?.unread_exact).toBe(0)
  })

  await step('opening the unfollowed thread proves its replies again and the count is exact', async () => {
    expect(valueOf(await openTopic(engine.registry, unfollowed)).outcome).toBe('fetched')
    await waitFor(() => (indexRow(engine, unfollowed)?.unread_exact === 1 ? true : undefined), WAIT_MS, 'the exact count')
    expect(indexRow(engine, unfollowed)?.unread_count).toBe(2)
  })
})

it('a thread stored before ranges existed is unknown until its first open, which fetches it whole', async () => {
  const first = await syncedEngine(engines)
  const id = `t:C0ENG:${first.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Old cache thread', at: first.fake.now() - 60 * 60_000, silent: true }).ts}`
  const root = id.split(':')[2]!
  for (const minutes of [50, 40, 30]) first.fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `old reply ${minutes}`, threadTs: root as never, at: first.fake.now() - minutes * 60_000, silent: true })
  expect(valueOf(await openTopic(first.registry, id)).outcome).toBe('fetched')
  await quiet(first)

  // What the update leaves: the replies stored, no range (the migration starts every thread unknown), the index
  // rows from the older build. A reply posted meanwhile is the kind the old count could not see was missing.
  const engine = await restart(engines, first, (fake) => {
    const db = new DatabaseSync(join(first.userData, 'workspaces', fake.teamId, 'cache.db'))
    try {
      db.prepare('DELETE FROM thread_ranges').run()
      db.prepare(`UPDATE sync_state SET value_json = '6' WHERE key = 'index-version'`).run()
    } finally {
      db.close()
    }
    fake.workspace.post({ channel: 'C0ENG', user: 'U0SAM', text: 'old reply 20', threadTs: root as never, at: fake.now() - 20 * 60_000, silent: true })
  })

  await step('before the open the window shows no stretch it cannot prove, and the count is not exact', async () => {
    const window = await windowOf(engine, id, { limit: 150 }, (value) => value.order.length > 0, 'the stored thread')
    expect(window.meta.windowCovered).toBe(false)
    expect(window.order).toHaveLength(1)
    expect(indexRow(engine, id)?.unread_exact).toBe(0)
  })

  await step('the first open reads the thread from its root, and the window is whole', async () => {
    engine.fake.resetCalls()
    expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
    expect(opens(engine)).toHaveLength(1)
    const window = await windowOf(engine, id, { limit: 150 }, (value) => value.meta.windowCovered === true && value.order.length === 5, 'the whole thread')
    expect(texts(window)).toEqual(['Old cache thread', 'old reply 50', 'old reply 40', 'old reply 30', 'old reply 20'])
    expect(window.meta.gapBefore).toBeUndefined()
    expect(indexRow(engine, id)?.unread_exact).toBe(1)
  })
})
