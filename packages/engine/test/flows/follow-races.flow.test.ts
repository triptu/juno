// Follows Juno did not make, or saw long ago (specs/follow.qnt): an accepted Unsubscribe is never undone by a
// late event or page, an undated or stale follow is checked with Slack, and a start reads every getView page.
// Every test but one starts warm on the synced default workspace.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { waitFor, type RunningEngine } from '../harness'
import { apiCalls, bootedEngine, DAY, errorOf, notRecheck, quiet, restart, seedThread, storedFollow, threadId as threadIdIn, tsOf, unsubscribe, valueOf, watchFollow, type SeededThread } from '../scenario'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = () => syncedEngine(engines)
const threadId = (engine: RunningEngine, channel: string, prefix: string) => threadIdIn(engine.fake, channel, prefix)
/** A followed thread of the fixture, and an active one the user does not follow. */
const followed = (engine: RunningEngine) => threadId(engine, 'C0ENG', 'Draft plan is in the doc.')
const shows = async (engine: RunningEngine, id: string) => (await engine.rows()).some((r) => r.id === id)

// An Unsubscribe Slack accepted sticks (specs/follow.qnt acceptedUnfollow)
/** Thread events wait in the fake, so one can arrive late and Slack's echo of Juno's own call can be dropped. */
const followFrames = ['thread_subscribed', 'thread_unsubscribed', 'thread_marked']

it('a followed event Slack sent before it accepted the Unsubscribe, arriving after the answer, does not bring the follow back', async () => {
  const engine = await synced()
  const id = followed(engine)
  engine.fake.holdFrames({ types: followFrames })
  // Followed again on another device; its event is delayed on the socket.
  engine.fake.followThread({ channel: 'C0ENG', threadTs: tsOf(id) })
  expect(valueOf(await unsubscribe(engine, id))).toEqual({ undo: { _tag: 'topics.subscribe', id } })
  await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone')
  expect(engine.fake.workspace.subscription('C0ENG', tsOf(id))?.subscribed).toBe(false)
  engine.fake.resetCalls()
  const watch = watchFollow(engine, 'C0ENG', tsOf(id))
  // The delayed follow arrives now; Slack never echoes the Unsubscribe.
  engine.fake.releaseFrames({ count: 1 })
  engine.fake.releaseFrames({ drop: true })
  await engine.socketIdle()
  await quiet(engine)
  expect(watch.stop()).toEqual(new Set([0]))
  expect(await shows(engine, id)).toBe(false)
  // The event could not be ordered against the Unsubscribe, so Slack was asked.
  expect(apiCalls(engine, 'conversations.replies').map((c) => c.args['ts'])).toContain(tsOf(id))
})

it('a getView page requested while the Unsubscribe was pending, answered after it, does not bring the follow back', async () => {
  const engine = await synced()
  const rows = await engine.rows()
  const newest = rows.filter((r) => r.kind === 'thread').toSorted((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))[0]!
  const channel = newest.channel.id
  engine.fake.holdFrames({ types: followFrames })
  // Slack sees the Unsubscribe only on release; the reconnect's getView page is taken before that and answered late.
  engine.fake.holdNext({ method: 'subscriptions.thread.remove', before: true })
  engine.fake.holdNext({ method: 'subscriptions.thread.getView' })
  const pending = unsubscribe(engine, newest.id)
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.remove' }) === 1 ? true : undefined), undefined, 'the held remove')
  await engine.rowsUntil((list) => !list.some((r) => r.id === newest.id), 'the thread gone')
  engine.fake.dropSocket()
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.getView' }) === 1 ? true : undefined), 20_000, 'the held page')
  engine.fake.release({ method: 'subscriptions.thread.remove' })
  expect(valueOf(await pending)).toEqual({ undo: { _tag: 'topics.subscribe', id: newest.id } })
  const watch = watchFollow(engine, channel, tsOf(newest.id))
  engine.fake.release()
  await engine.phase('live', 20_000)
  await engine.syncIdle()
  engine.fake.releaseFrames({ drop: true })
  expect(watch.stop()).toEqual(new Set([0]))
  expect(await shows(engine, newest.id)).toBe(false)
  expect(engine.fake.workspace.subscription(channel, tsOf(newest.id))?.subscribed).toBe(false)
})

it('a getView page in flight cannot bring back a thread the user unsubscribed meanwhile', async () => {
  const engine = await synced()
  const rows = await engine.rows()
  const newest = rows.filter((r) => r.kind === 'thread').toSorted((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))[0]!
  // The reconnect's first getView page is taken while the thread is still followed, and answered late.
  engine.fake.holdNext({ method: 'subscriptions.thread.getView' })
  engine.fake.dropSocket()
  await waitFor(() => (engine.fake.heldCount({ method: 'subscriptions.thread.getView' }) === 1 ? true : undefined), 20_000, 'the held page')
  expect(valueOf(await unsubscribe(engine, newest.id))).toEqual({ undo: { _tag: 'topics.subscribe', id: newest.id } })
  await engine.rowsUntil((list) => !list.some((r) => r.id === newest.id), 'the thread gone')
  engine.fake.release()
  await engine.phase('live', 20_000)
  await quiet(engine)
  expect(await shows(engine, newest.id)).toBe(false)
  expect(storedFollow(engine, newest.channel.id, tsOf(newest.id))).toBe(0)
  expect(engine.fake.workspace.subscription(newest.channel.id, tsOf(newest.id))?.subscribed).toBe(false)
})

it('an Unsubscribe whose answer is lost, and whose root lookup fails, keeps the unfollow and asks Slack again', async () => {
  const engine = await synced()
  const id = followed(engine)
  engine.fake.holdFrames({ types: followFrames })
  // Slack accepts every attempt the client makes, and every answer is lost; then the first lookup fails.
  engine.fake.loseResponse({ method: 'subscriptions.thread.remove', times: 3 })
  engine.fake.forceError({ method: 'conversations.replies', error: 'not_allowed' })
  engine.fake.resetCalls()
  const pending = unsubscribe(engine, id)
  await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the thread gone')
  const watch = watchFollow(engine, 'C0ENG', tsOf(id))
  expect(errorOf(await pending)).toMatchObject({ _tag: 'Offline' })
  expect(engine.fake.workspace.subscription('C0ENG', tsOf(id))?.subscribed).toBe(false)
  // The lookup is retried in the background until Slack answers.
  await waitFor(() => (apiCalls(engine, 'conversations.replies').some((c) => c.ok && c.args['ts'] === tsOf(id)) ? true : undefined), 20_000, 'a lookup that worked')
  await engine.handle.commandIdle()
  engine.fake.releaseFrames({ drop: true })
  expect(watch.stop()).toEqual(new Set([0]))
  expect(await shows(engine, id)).toBe(false)
})

// Follows Juno last saw long ago, or not at all
it('an undated thread_unsubscribed is not trusted: Slack is asked for the root, and its answer wins', async () => {
  const engine = await synced()
  const id = followed(engine)
  engine.fake.resetCalls()
  // Slack still has the thread followed; the frame carries no event_ts.
  engine.fake.emitFrame({ type: 'thread_unsubscribed', subscription: { type: 'thread', channel: 'C0ENG', thread_ts: tsOf(id), active: false } })
  await waitFor(() => (apiCalls(engine, 'conversations.replies').some((c) => c.args['ts'] === tsOf(id)) ? true : undefined), undefined, 'the root lookup')
  await quiet(engine)
  expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(1)
  expect(await shows(engine, id)).toBe(true)
})

it('a follow last seen before the window is checked with Slack when its thread gets a reply', async () => {
  // Cold: a warm start's follow pass records the observation in memory (FollowFence), which outranks the aged row.
  const engine = await bootedEngine(engines)
  const id = followed(engine)
  // Juno last saw this follow a month ago, and it was dropped elsewhere since without an event reaching Juno.
  // A month cannot pass in a test, so the stored observation is aged in place.
  ageFollow(engine, id)
  engine.fake.workspace.subscriptions.get(`C0ENG:${tsOf(id)}`)!.subscribed = false
  engine.fake.resetCalls()
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Any news on the dry run?', threadTs: tsOf(id) })
  await engine.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the stale follow gone')
  expect(storedFollow(engine, 'C0ENG', tsOf(id))).toBe(0)
  expect(apiCalls(engine, 'conversations.replies').map((c) => c.args['ts'])).toContain(tsOf(id))
})

it('a thread unfollowed in Slack while Juno was closed leaves the sidebar at the next start, and comes back when followed again', async () => {
  const first = await synced()
  const id = followed(first)
  const second = await restart(engines, first, (fake) => fake.unfollowThread({ channel: 'C0ENG', threadTs: tsOf(id) }))
  await second.rowsUntil((rows) => !rows.some((r) => r.id === id), 'the unfollowed thread gone')
  expect(storedFollow(second, 'C0ENG', tsOf(id))).toBe(0)
  // The thread was missing from the complete getView list, so its root was asked; no other root was.
  expect(apiCalls(second, 'conversations.replies').filter(notRecheck).filter((c) => c.args['_x_reason'] === 'root').map((c) => c.args['ts'])).toEqual([tsOf(id)])

  const third = await restart(engines, second, (fake) => fake.followThread({ channel: 'C0ENG', threadTs: tsOf(id) }))
  await third.rowsUntil((rows) => rows.some((r) => r.id === id), 'the thread followed again')
  expect(storedFollow(third, 'C0ENG', tsOf(id))).toBe(1)
})

it('a followed thread older than the quiet window becomes a row when it gets a reply', async () => {
  const first = await synced()
  let old: SeededThread | undefined
  const engine = await restart(engines, first, (fake) => {
    old = seedThread(fake, { channel: 'C0ENG', text: 'Old capacity plan', ago: 20 * DAY, replies: [20 * DAY, 19 * DAY], follow: true })
  })
  expect(await shows(engine, old!.id)).toBe(false)
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Revisiting this for Q3.', threadTs: old!.ts })
  const rows = await engine.rowsUntil((list) => list.some((r) => r.id === old!.id), 'the old followed thread')
  expect(rows.find((r) => r.id === old!.id)).toMatchObject({ subscribed: true, unreadCount: 1, preview: { text: 'Revisiting this for Q3.' } })
})

it('a start reads every getView page: reads on another device clear, and a follow made elsewhere appears (review M3 finding 2)', async () => {
  const first = await synced()
  const threads: Array<SeededThread> = []
  const second = await restart(engines, first, (fake) => {
    for (let i = 0; i < 25; i++) {
      threads.push(seedThread(fake, { channel: 'C0PLATFORM', text: `Rollout step ${i + 1}`, ago: 3 * DAY, replies: [2 * DAY + i * 60_000, DAY + i * 60_000], follow: true, unread: 1 }))
    }
  })
  const ids = new Set(threads.map((t) => t.id))
  await second.rowsUntil((rows) => rows.filter((r) => ids.has(r.id) && r.unreadCount === 1).length === 25, 'the 25 unread threads')

  const flaky = threadId(second, 'C0ENG', 'checkout.spec')
  const third = await restart(engines, second, (fake) => {
    // Read on the phone overnight, and a thread followed there.
    for (const t of threads) fake.markThreadRead({ channel: t.channel, threadTs: t.ts, ts: fake.workspace.replies(t.channel, t.ts as never).at(-1)!.ts })
    fake.followThread({ channel: 'C0ENG', threadTs: tsOf(flaky) })
  })
  await third.rowsUntil(
    (list) => list.filter((r) => ids.has(r.id) && r.unreadCount === 0).length === 25 && list.some((r) => r.id === flaky && r.subscribed),
    'every thread read and the new follow',
  )
  await third.syncIdle()
  // 38 follows are four pages of ten: every one was read, and none twice per pass.
  const pages = apiCalls(third, 'subscriptions.thread.getView').length
  expect(pages).toBeGreaterThanOrEqual(4)
  expect(pages).toBeLessThanOrEqual(8)
})

/** Makes the stored observation of a follow a month old, as if Juno last saw it then. */
function ageFollow(engine: RunningEngine, id: string): void {
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
  try {
    db.prepare('UPDATE thread_subs SET observed_at = ? WHERE channel = ? AND thread_ts = ?').run(`${Math.floor(Date.now() / 1000) - 30 * 86_400}.000000`, 'C0ENG', tsOf(id))
  } finally {
    db.close()
  }
}
