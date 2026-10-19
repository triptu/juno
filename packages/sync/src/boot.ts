/**
 * Cold boot, warm boot and the catch-up after a reconnect (architecture
 * 5.2, 5.8). Every page lands through `applyPage`, so the merge rules and
 * `reindexTopics` run the same way whatever brought the data.
 *
 * Cold boot, in order: `client.userBoot` with `users.prefs.get` beside it,
 * `client.counts` (which also gives every conversation active in the window
 * a provisional Main row), the people of the DMs, and the first page of
 * followed threads from `subscriptions.thread.getView`, all on the
 * interactive lane. Then the quick-start marker (`QUICK_START_KEY`): the
 * sidebar shows rows from here on. One or two newest-first searches of the
 * window (`searchPreviews`), beside everything after, then give the busiest
 * conversations a preview within seconds. The other `getView` pages (10 per page
 * live, back to the quiet window) then run beside one history page per
 * active conversation (`historyOrder`: DMs, mentions, unread followed
 * threads, other unread channels and the user's own channels first, then newest first; background lane, skipping
 * conversations an interrupted boot already covered), and beside history,
 * once the `getView` pages are stored, a latest-reply fetch for the
 * unfollowed threads it finds with the most recent activity, so their rows
 * have a preview. Once the DMs, mentions and unread followed threads have
 * their history, the `getView` pages are stored and the preview search is
 * done, the Home marker (`HOME_READY_KEY`): Home is ready while the rest of
 * history goes on. After history, beside the
 * previews still running: unknown users from the edge, then the discovery
 * sweep over the window, so Main knows about replies to roots older than
 * the window.
 *
 * Warm boot: `client.userBoot`, a full `client.counts` (membership is
 * derived from it), history since the synced range for conversations whose
 * `latest` moved, `getView` back to the window, the discovery sweep for
 * the gap, users. Reconnect refreshes workspace and full membership on the
 * background lane, and reads `getView` back to the last moment the store
 * was in step. A periodic sweep uses incremental counts. `followPass` reads
 * the followed threads over the window and checks the follows it left out;
 * `runSync` schedules it at most hourly.
 */
import { compareTs, maxTs, millisToTs, type Me, type Ts, type UsergroupId } from '@juno/domain'
import type { CountEntry } from '@juno/slack-schema'
import { SlackApi, SlackEdge, SlackSession, type SlackApiError, type SlackAuthRequired } from '@juno/slack'
import type { Message, ThreadView } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Clock, Deferred, Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { activeConversations, historyOrder, loadCounts } from './counts'
import { saveRepairMarkers, queueRepairs } from './mutationRepair'
import { discoverSince, searchPreviews } from './discovery'
import { FollowFence } from './followFence'
import { readMetadata, storeMetadata } from './metadata'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'
import { recheck, type RecheckOptions } from './recheck'
import { reindexTopics } from './reindex'
import { threadViewPageUnchanged } from './threadViews'
import { fillUsers, nameFirst } from './users'
import {
  addSyncedRange,
  AVATAR_BASE_KEY,
  getSyncState,
  latestSyncedRange,
  latestSyncedRanges,
  markRepliesComplete,
  observeRead,
  readState,
  seedTopicRead,
  setSyncState,
  setThreadSub,
  threadMessages,
  toConversationRow,
  upsertTeam,
  upsertUsers,
} from './write'

export const BOOT_KEY = 'boot'
/**
 * `sync_state.quickStart`: the cold boot's quick steps are done (workspace,
 * membership, the people of the DMs, the first page of followed threads), so
 * the sidebar's rows are its own and it shows them while the rest fills in.
 */
export const QUICK_START_KEY = 'quickStart'
/**
 * `sync_state.homeReady`: the cold boot has read what Home is made of (the
 * history of DMs, mentions and unread followed threads, every `getView`
 * page and the preview search), so Home is ready and its checks may start
 * while the rest of history fills in (owner, 10-18). A finished boot
 * (`BOOT_KEY`) means the same.
 */
export const HOME_READY_KEY = 'homeReady'
/** `sync_state.me`: the user and their user groups, so a command outside the sync re-indexes with the same mention rules. */
export const ME_KEY = 'me'

/** What `sync_state.boot` records once a boot completes. */
export interface BootState {
  readonly quietDays?: number
  readonly completedAt: number
  readonly countsLastFetched?: number
  /** The last moment the store was known to be in step with Slack; discovery sweeps and the reconnect `getView` start here. */
  readonly lastSyncAt: number
}

export type Phase = (phase: { _tag: 'booting'; first?: boolean } | { _tag: 'catching-up'; done: number; total: number; first?: boolean }) => Effect.Effect<void>

export type BootError = SlackApiError | SqlError
export type BootServices = SlackApi | SlackEdge | SlackSession | StoreWriter | Invalidation

const DAY = 24 * 60 * 60 * 1000

export const bootState = (): Effect.Effect<BootState | undefined, SqlError, StoreWriter> => getSyncState<BootState>(BOOT_KEY)

/**
 * The user as the last boot saw them, with their user groups, for a
 * command that re-indexes outside the sync. Before any boot, the team's
 * self id without groups; `undefined` when the store has neither.
 */
export const storedMe: Effect.Effect<Me | undefined, SqlError, StoreWriter> = Effect.gen(function* () {
  const me = yield* getSyncState<Me>(ME_KEY)
  if (me !== undefined) return me
  const sql = yield* StoreWriter
  const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  const self = team[0]?.self_user_id
  return self === null || self === undefined ? undefined : { userId: self as Me['userId'] }
})

const windowStartMillis = (ctx: SyncContext) => Effect.map(Clock.currentTimeMillis, (now) => now - ctx.config.quietDays * DAY)
const nowTs = Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))

/**
 * `client.userBoot`: team, self, the user groups self belongs to, and the
 * metadata of every conversation of the workspace (member or not; the
 * response carries no membership or read state, observed live). `prefs`
 * only on a cold boot.
 */
const loadWorkspace = (ctx: SyncContext, withPrefs: boolean, lane: 'interactive' | 'background' = 'interactive'): Effect.Effect<void, BootError, BootServices> =>
  readMetadata(ctx.metadata, (observed) => Effect.gen(function* () {
    const api = yield* SlackApi
    // Independent calls: prefs goes beside userBoot.
    const [boot, own] = yield* Effect.all([
      api.call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, { lane, reason: 'fetch-client-data' }),
      withPrefs ? Effect.map(api.call('users.prefs.get', {}, { lane, reason: 'prefs' }), (answer) => answer.prefs) : Effect.succeed(undefined),
    ], { concurrency: 2 })
    const prefs = withPrefs ? own : (boot.prefs ?? undefined)
    const selfId = ctx.me.userId
    ctx.me = { userId: selfId, usergroupIds: (boot.subteams?.self ?? []) as ReadonlyArray<UsergroupId> }
    yield* transaction(
      Effect.gen(function* () {
        yield* upsertTeam(boot.team, selfId, prefs, undefined)
        yield* setSyncState(ME_KEY, ctx.me)
        if (boot.team.avatar_base_url) yield* setSyncState(AVATAR_BASE_KEY, boot.team.avatar_base_url)
        yield* upsertUsers([boot.self])
        yield* storeMetadata(observed, [...boot.channels.map((c) => toConversationRow(c)), ...boot.ims.map((im) => toConversationRow(im))])
      }),
    )
    const presence = boot.self.manual_presence
    if (presence === 'active' || presence === 'away') yield* ctx.onSelfPresence(presence)
  }))

/** One thread from `getView`: root, unread and latest replies, Slack's subscription and read pointer. */
const applyThreadView = (ctx: SyncContext, view: ThreadView, requestedAt: Ts, lane: 'interactive' | 'background'): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const root = view.root_msg
    const channel = root.channel
    const seen = new Map<string, Message>()
    // Slack omits unread_replies when nothing in the thread is unread.
    for (const reply of [...(view.latest_replies ?? []), ...(view.unread_replies ?? [])]) seen.set(reply.ts, reply)
    const topic = threadTopicOf(channel, root.ts)
    yield* nameFirst(ctx, [root, ...seen.values()], lane)
    yield* transaction(
      Effect.gen(function* () {
        // The view lists followed threads: a root without the flag is followed. Later events win over this page.
        yield* setThreadSub(channel, root.ts, root.subscribed ?? true, root.last_read, { kind: 'page', requestedAt })
        // Slack's pointer for a followed thread. Without one, a thread seen for the first time starts read to its latest reply.
        if (root.last_read === undefined) yield* seedTopicRead(topic, root.latest_reply ?? root.ts)
        else if ((yield* observeRead(topic, { kind: 'page', lastReadTs: root.last_read, requestedAt })) === 'lookup') {
          yield* Queue.offer(ctx.rootFetches, { channel, ts: root.ts })
        }
      }),
    )
    yield* applyPage(ctx, channel, [root, ...seen.values()], { kind: 'page', requestedAt })
    const stored = yield* threadMessages(channel, root.ts)
    const replies = stored.filter((m) => m.ts !== root.ts && m.deleted === 0).length
    // The view carries every unread reply, so coverage is complete from Slack's read pointer on. The row's count turns
    // exact with it, so the thread is re-indexed in the same transaction rather than waiting for a later page to do it.
    const completeFrom = root.last_read ?? root.latest_reply ?? root.ts
    const syncedAt = yield* Clock.currentTimeMillis
    yield* transaction(Effect.andThen(markRepliesComplete(channel, root.ts, replies >= root.reply_count, syncedAt, completeFrom), reindexTopics([topic], reindexOptions(ctx))))
  })

const applyThreadViewObservations = (
  ctx: SyncContext,
  observations: ReadonlyArray<{ readonly view: ThreadView; readonly requestedAt: Ts }>,
  lane: 'interactive' | 'background',
): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const unchanged = yield* transaction(threadViewPageUnchanged(ctx, observations))
    const changed = observations.filter((_, index) => unchanged[index] !== true)
    yield* nameFirst(ctx, changed.flatMap(({ view }) => [view.root_msg, ...(view.latest_replies ?? []), ...(view.unread_replies ?? [])]), lane)
    for (const { view, requestedAt } of changed) yield* applyThreadView(ctx, view, requestedAt, lane)
  })

/**
 * Followed threads from `subscriptions.thread.getView`, newest activity
 * first, 10 per page live whatever `limit` says (research section 10),
 * until the last root on a page is older than `until`.
 *
 * Because the list is sorted by activity, the pages list every followed
 * thread with activity between `until` and the first request. With `probe`,
 * every stored follow in that range that no page listed is then looked up
 * by its root (`probeUnlisted`): absence is never read as "unfollowed" by
 * itself (specs/follow.qnt: `startScan` .. `finishScan`, then
 * `probeAbsent`). Live an account can follow thousands of threads (over
 * 9,000 measured), so no pass reads the whole list; a follow older than the
 * window is checked when its thread next gets a reply (`events.ts`).
 */
const loadThreadViews = (
  ctx: SyncContext,
  options: {
    readonly until: Ts
    readonly probe: boolean
    readonly lane: 'interactive' | 'background'
    /** A background follow pass can certify all fetched pages with one store snapshot. */
    readonly batchPages?: boolean
    /** Runs once, after the first page is stored: the cold boot's quick start ends here. */
    readonly afterFirstPage?: Effect.Effect<void, BootError, BootServices>
  },
): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const listed = new Set<string>()
    let firstRequestedAt: Ts | undefined
    let current: Ts | undefined
    const batched: Array<{ readonly view: ThreadView; readonly requestedAt: Ts }> = []
    // `until` when the pages stopped there; undefined when they reached the end of the list.
    let coveredFrom: Ts | undefined = options.until
    while (true) {
      const requestedAt = yield* nowTs
      firstRequestedAt ??= requestedAt
      const pageResult = yield* Effect.result(api.call(
        'subscriptions.thread.getView',
        { limit: ctx.config.getViewPageLimit, ...(current === undefined ? {} : { current_ts: current }) },
        { lane: options.lane, reason: 'threads' },
      ))
      if (pageResult._tag === 'Failure') {
        // Keep repairs from every page Slack already returned. A later-page
        // failure must not discard them; the next pass can retry the gap.
        if (batched.length > 0) yield* applyThreadViewObservations(ctx, batched, options.lane)
        return yield* pageResult.failure
      }
      const page = pageResult.success
      for (const view of page.threads) listed.add(`${view.root_msg.channel}:${view.root_msg.ts}`)
      const observations = page.threads.map((view) => ({ view, requestedAt }))
      if (options.batchPages === true) batched.push(...observations)
      else yield* applyThreadViewObservations(ctx, observations, options.lane)
      if (current === undefined && options.afterFirstPage !== undefined) yield* options.afterFirstPage
      const last = page.threads.at(-1)
      const lastActivity = last?.root_msg.latest_reply ?? last?.root_msg.ts
      if (lastActivity === undefined) {
        // An empty page that says there is more has no cursor to go on: the list is incomplete, nothing is probed.
        if (page.has_more) return yield* Effect.logWarning('sync: getView stopped without a cursor')
        coveredFrom = undefined
        break
      }
      if (!page.has_more) {
        coveredFrom = undefined
        break
      }
      if (compareTs(lastActivity, options.until) < 0) break
      current = lastActivity
      yield* Effect.yieldNow
    }
    if (batched.length > 0) yield* applyThreadViewObservations(ctx, batched, options.lane)
    if (options.probe) yield* probeUnlisted(ctx, listed, coveredFrom, firstRequestedAt)
  })

/**
 * The pass over the followed threads with activity inside the quiet window,
 * then the lookup of stored follows in that range it left out. On the
 * background lane. `runSync` runs it with a catch-up or sweep at most every
 * `SyncConfig.followPassMillis`; the boots make the same pass themselves.
 */
export const followPass = (ctx: SyncContext): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const windowStart = millisToTs(yield* windowStartMillis(ctx))
    yield* loadThreadViews(ctx, { until: windowStart, probe: true, lane: 'background', batchPages: true })
  })

/**
 * Looks up the root of every stored follow the `getView` pages should have
 * listed and did not, in conversations the user is still in, and applies
 * the `subscribed` the root carries (`false` clears the follow; a root
 * without the field changes nothing). In range: activity at or after
 * `coveredFrom` (any activity when the pages reached the end) and before
 * the first page was requested. A follow observed or changed since then (an
 * event, a command) is left alone.
 */
const probeUnlisted = (
  ctx: SyncContext,
  listed: ReadonlySet<string>,
  coveredFrom: Ts | undefined,
  listRequestedAt: Ts,
): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const api = yield* SlackApi
    const fence = yield* FollowFence
    const followed = yield* sql<{ channel: string; thread_ts: string; observed_at: string | null; activity: string }>`
      SELECT s.channel, s.thread_ts, s.observed_at, COALESCE(m.latest_reply, m.ts, s.thread_ts) AS activity
      FROM thread_subs s JOIN conversations c ON c.id = s.channel
      LEFT JOIN messages m ON m.channel = s.channel AND m.ts = s.thread_ts
      WHERE s.subscribed = 1 AND c.is_member = 1`
    for (const row of followed) {
      if (listed.has(`${row.channel}:${row.thread_ts}`)) continue
      if (coveredFrom !== undefined && compareTs(row.activity, coveredFrom) < 0) continue
      if (compareTs(row.activity, listRequestedAt) >= 0) continue
      const observedAt = fence.effective(row.channel, row.thread_ts, row.observed_at ?? undefined)
      if (observedAt !== undefined && compareTs(observedAt, listRequestedAt) >= 0) continue
      const requestedAt = yield* nowTs
      const page = yield* api
        .call(
          'conversations.replies',
          { channel: row.channel, ts: row.thread_ts as Ts, oldest: row.thread_ts as Ts, inclusive: true, limit: 1 },
          { lane: 'background', reason: 'root' },
        )
        .pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
      const root = page?.messages.find((m) => m.ts === row.thread_ts)
      if (root === undefined) continue
      yield* applyPage(ctx, row.channel, [root], { kind: 'page', requestedAt })
      yield* Effect.yieldNow
    }
  })

interface HistoryOptions {
  /** Cold boot: see `ApplyPageOptions.seedReadBefore`. */
  readonly seedReadBefore?: string
}

/**
 * The newest history page of a conversation inside the window, reaching
 * back to Main's read pointer when that is older, so one page can make the
 * unread count exact. Records the range it covered.
 */
const loadHistoryWindow = (ctx: SyncContext, channel: string, start: Ts, options: HistoryOptions): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = yield* nowTs
    const pointer = (yield* readState(mainTopicOf(channel))).lastReadTs
    const from = pointer !== undefined && compareTs(pointer, start) < 0 ? pointer : start
    const page = yield* api.call(
      'conversations.history',
      { channel, oldest: from, inclusive: true, limit: ctx.config.historyPageLimit, ignore_replies: true, no_user_profile: true },
      { lane: 'background', reason: 'history' },
    )
    yield* nameFirst(ctx, page.messages)
    // The range first, so the index of this page already knows what history covers.
    const oldest = page.messages.at(-1)?.ts
    yield* transaction(addSyncedRange(channel, page.has_more && oldest !== undefined ? oldest : from, requestedAt))
    yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [mainTopicOf(channel)], ...options })
  })

/**
 * One conversation's history, skipped when Slack refuses it (a channel
 * deleted or left between `client.counts` and the call): one conversation
 * must not fail the whole boot and make it retry forever. Transport, rate
 * limit and auth failures still fail the step.
 */
const skipRejected = (load: Effect.Effect<void, BootError, BootServices>): Effect.Effect<void, BootError, BootServices> =>
  load.pipe(Effect.catchTag('SlackRejected', (error) => Effect.logWarning('sync: history refused, skipped', { tag: error._tag, reason: error.error })))

/** History since the synced range, in pages, for a conversation whose `latest` moved. */
const loadHistorySince = (ctx: SyncContext, channel: string, since: string): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = yield* nowTs
    let cursor: string | undefined
    let oldestSeen: string | undefined
    let complete = false
    for (let i = 0; i < ctx.config.catchUpPages; i++) {
      const page = yield* api.call(
        'conversations.history',
        {
          channel,
          oldest: since,
          inclusive: false,
          limit: ctx.config.historyPageLimit,
          ignore_replies: true,
          no_user_profile: true,
          ...(cursor === undefined ? {} : { cursor }),
        },
        { lane: 'background', reason: 'history-since' },
      )
      yield* nameFirst(ctx, page.messages)
      oldestSeen = page.messages.at(-1)?.ts ?? oldestSeen
      cursor = page.response_metadata?.next_cursor
      complete = !page.has_more || cursor === undefined || cursor === ''
      yield* transaction(addSyncedRange(channel, complete || oldestSeen === undefined ? since : oldestSeen, requestedAt))
      yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [mainTopicOf(channel)] })
      if (complete) break
      yield* Effect.yieldNow
    }
  })

/**
 * Rows for unfollowed threads discovered through history have only the root;
 * fetch the latest reply for a preview, for at most `previewThreads` of them,
 * the most recently active first. Runs beside history: `replies` has its own
 * clock on the background lane, so the previews cost the boot no time. It
 * starts once the `getView` pass is stored (`threads`), so a followed thread
 * is never taken for an unfollowed one. Each history page offers to
 * `landed`; with no root waiting, it waits for the next page, and ends once
 * `historyDone` is set and none is left.
 */
const loadThreadPreviews = (
  ctx: SyncContext,
  seedReadBefore: string,
  threads: Deferred.Deferred<void>,
  landed: Queue.Queue<void>,
  historyDone: Deferred.Deferred<void>,
): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* Deferred.await(threads)
    const sql = yield* StoreWriter
    const api = yield* SlackApi
    const tried = new Set<string>()
    while (tried.size < ctx.config.previewThreads) {
      // Read before the query: a page that lands after it offers again, so no root is missed.
      const finished = yield* Deferred.isDone(historyDone)
      const roots = yield* sql<{ channel: string; root_ts: string; latest_reply: string | null }>`
        SELECT i.channel, i.root_ts, m.latest_reply FROM topic_index i
          JOIN messages m ON m.channel = i.channel AND m.ts = i.root_ts
          WHERE i.kind = 'thread' AND m.reply_count > 0
            AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.channel = i.channel AND r.thread_ts = i.root_ts AND r.ts <> i.root_ts)
          ORDER BY i.last_activity_ts DESC LIMIT ${ctx.config.previewThreads}`
      const root = roots.find((row) => !tried.has(`${row.channel}:${row.root_ts}`))
      if (root === undefined) {
        if (finished) return
        yield* Effect.raceFirst(Queue.take(landed), Deferred.await(historyDone))
        continue
      }
      tried.add(`${root.channel}:${root.root_ts}`)
      if (root.latest_reply === null) continue
      const requestedAt = yield* nowTs
      const page = yield* api
        .call(
          'conversations.replies',
          { channel: root.channel, ts: root.root_ts as Ts, oldest: root.latest_reply, inclusive: true, limit: 2 },
          { lane: 'background', reason: 'thread-preview' },
        )
        .pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
      if (page === undefined) continue
      yield* nameFirst(ctx, page.messages)
      yield* applyPage(ctx, root.channel, page.messages, { kind: 'page', requestedAt }, { seedReadBefore })
      yield* Effect.yieldNow
    }
  })

/**
 * Runs a discovery sweep and says whether it finished. It fills gaps but
 * nothing depends on it, so a failure other than an expired session is
 * logged and does not fail the boot or the catch-up; the caller keeps the
 * gap's start so the next sweep searches it again.
 */
const discoverOrLog = (sweep: Effect.Effect<void, SlackApiError | SqlError, BootServices>): Effect.Effect<boolean, SlackAuthRequired, BootServices> =>
  sweep.pipe(
    Effect.as(true),
    Effect.catch((error) =>
      error._tag === 'SlackAuthRequired' ? Effect.fail(error) : Effect.as(Effect.logWarning('sync: discovery failed', { tag: error._tag }), false),
    ),
  )

/** True when a synced range already covers `[start, latest]`: an interrupted cold boot fetched this conversation. */
const covered = (channel: string, start: Ts, latest: Ts): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.map(latestSyncedRange(channel), (range) => range !== undefined && compareTs(range.from_ts, start) <= 0 && compareTs(range.to_ts, latest) >= 0)

/** Everything Slack knows about the workspace, into an empty cache (architecture 5.2). */
export const coldBoot = (ctx: SyncContext, phase: Phase): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* phase({ _tag: 'booting', first: true })
    const startedAt = yield* Clock.currentTimeMillis
    // Unfollowed threads count as read up to here; a reply during the boot stays unread.
    const bootTs = millisToTs(startedAt)
    const quietDays = ctx.config.quietDays
    const windowStart = yield* windowStartMillis(ctx)
    const start = millisToTs(windowStart)
    yield* loadWorkspace(ctx, true)
    const counts = yield* loadCounts(ctx, undefined)
    const active = yield* activeConversations(counts.entries, start)
    // A Main row from `client.counts` for each conversation history will read, so channels and DMs show before their pages land.
    yield* transaction(reindexTopics(active.map((conversation) => mainTopicOf(conversation.id)), { ...reindexOptions(ctx), provisionalMain: true }))
    // Names before rows: the people of every DM and group DM, on the interactive lane.
    yield* fillUsers(ctx, 'interactive')
    // Before any row shows: the engine holds back what Automated's rules cannot place yet.
    yield* ctx.onListed
    // The quick start ends with the first page of followed threads; the other pages run beside history.
    const quickStarted = yield* Deferred.make<void>()
    const quickStart = Effect.flatMap(Clock.currentTimeMillis, (at) => transaction(setSyncState(QUICK_START_KEY, { at }))).pipe(
      Effect.andThen(Deferred.succeed(quickStarted, undefined)),
      Effect.asVoid,
    )
    const threads = loadThreadViews(ctx, { until: start, probe: true, lane: 'interactive', afterFirstPage: quickStart })
    // Once rows show, the newest messages of the workspace give the busiest channels a preview before their history lands.
    const previewsDone = yield* Deferred.make<void>()
    const previews = Deferred.await(quickStarted).pipe(
      Effect.andThen(ctx.config.previewSearchPages > 0 ? discoverOrLog(searchPreviews(ctx, windowStart, { seedReadBefore: bootTs })) : Effect.void),
      Effect.ensuring(Deferred.succeed(previewsDone, undefined)),
    )
    // Each history page wakes the thread previews beside it.
    const landed = yield* Queue.sliding<void>(1)
    const historyDone = yield* Deferred.make<void>()
    const homeHistoryDone = yield* Deferred.make<void>()
    const history = Effect.gen(function* () {
      yield* phase({ _tag: 'catching-up', done: 0, total: active.length, first: true })
      let done = 0
      // DMs, mentions and unread followed threads first, which is what Home waits for; then the other unread channels,
      // the user's own channels and the rest by recency.
      const { order, home } = yield* historyOrder(ctx, active, counts)
      for (const conversation of order) {
        if (done === home) yield* Deferred.succeed(homeHistoryDone, undefined)
        // A boot that failed half way left ranges behind; what they cover is not fetched again.
        if (!(yield* covered(conversation.id, start, conversation.latest))) {
          yield* skipRejected(loadHistoryWindow(ctx, conversation.id, start, { seedReadBefore: bootTs }))
          yield* Queue.offer(landed, undefined)
          yield* ctx.onHistory(conversation.id)
        }
        yield* phase({ _tag: 'catching-up', done: ++done, total: active.length, first: true })
        yield* Effect.yieldNow
      }
    }).pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(homeHistoryDone, undefined), Deferred.succeed(historyDone, undefined))))
    const threadsDone = yield* Deferred.make<void>()
    // Home is ready once what it is made of is stored; the rest of history goes on beside it.
    const homeReady = Effect.all([Deferred.await(homeHistoryDone), Deferred.await(threadsDone), Deferred.await(previewsDone)], { discard: true }).pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.flatMap((at) => transaction(setSyncState(HOME_READY_KEY, { at }))),
    )
    const pages = Effect.gen(function* () {
      yield* Effect.all([threads.pipe(Effect.ensuring(Deferred.succeed(threadsDone, undefined))), history], { concurrency: 2, discard: true })
      yield* fillUsers(ctx)
      // Discovery finds replies inside the window to roots older than it: Main's activity, which windowed history cannot see.
      return yield* discoverOrLog(discoverSince(ctx, windowStart, counts.entries, { seedReadBefore: bootTs }))
    })
    // Independent methods, so they run side by side: getView pages, history and then discovery, and replies for thread previews.
    const rest = Effect.map(Effect.all([pages, loadThreadPreviews(ctx, bootTs, threadsDone, landed, historyDone)], { concurrency: 2 }), ([found]) => found)
    // The preview search runs beside the whole boot, so a slow one delays nothing; the boot is recorded after both.
    const [discovered] = yield* Effect.all([rest, previews, homeReady], { concurrency: 3 })
    yield* fillUsers(ctx)
    const state: BootState = {
      quietDays,
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      // A failed discovery leaves the gap for the next sweep to search again.
      lastSyncAt: discovered ? startedAt : windowStart,
    }
    yield* transaction(Effect.andThen(saveRepairMarkers(counts.entries), setSyncState(BOOT_KEY, state)))
  })

export interface CatchUpOptions {
  /** Refresh team, conversations and self first, and take the full counts list (warm boot: yes; reconnect: no). */
  readonly refreshWorkspace: boolean
  /** Page the followed threads with activity since the window (warm boot) or `lastSyncAt` (reconnect). */
  readonly refreshThreads: boolean
  /** Full metadata and membership after a socket gap, on the background lane. */
  readonly refreshMetadata?: boolean
  /** Read the likely topics again for changes made during a gap (`recheck.ts`): after a drop or a restart, not on a sweep. */
  readonly recheck?: RecheckOptions
  /** Persist the new cursor. Periodic sweeps keep it in memory; a restart can safely replay from the last durable boot or reconnect. */
  readonly persistState?: boolean
  /** Periodic counts stage candidates; socket liveness decides when an older candidate can be promoted. */
  readonly observeSweepMarkers?: (entries: ReadonlyArray<CountEntry>) => Effect.Effect<void, BootError, BootServices>
}

/**
 * Brings a populated cache up to date: counts, history since the synced
 * ranges where `latest` moved, the followed threads with activity since the
 * store was last in step, the discovery sweep for the gap since `since`,
 * after a gap the recheck of the likely topics, and unknown users. Used by
 * the warm boot and after every reconnect.
 */
export const catchUp = (ctx: SyncContext, previous: BootState, phase: Phase, options: CatchUpOptions): Effect.Effect<BootState, BootError, BootServices> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const start = millisToTs(yield* windowStartMillis(ctx))
    const refreshMetadata = options.refreshWorkspace || options.refreshMetadata === true
    const metadataLane = options.refreshMetadata === true ? 'background' : 'interactive'
    if (refreshMetadata) yield* loadWorkspace(ctx, false, metadataLane)
    // A full list after a workspace refresh, so a channel left while the app was closed drops out.
    const counts = yield* loadCounts(ctx, refreshMetadata ? undefined : previous.countsLastFetched, metadataLane)
    // Names first: a DM joined meanwhile, and anyone an earlier run left without one.
    yield* fillUsers(ctx, 'interactive')
    const active = yield* activeConversations(counts.entries, start)
    const ranges = yield* latestSyncedRanges(active.map((conversation) => conversation.id))
    const moved: Array<{ id: string; since: string | undefined }> = []
    for (const conversation of active) {
      const range = ranges.get(conversation.id)
      if (range === undefined || conversation.latest > range.to_ts) moved.push({ id: conversation.id, since: range?.to_ts })
    }
    if (moved.length > 0) yield* phase({ _tag: 'catching-up', done: 0, total: moved.length })
    let done = 0
    for (const conversation of moved) {
      if (conversation.since === undefined) yield* skipRejected(loadHistoryWindow(ctx, conversation.id, start, {}))
      else yield* skipRejected(loadHistorySince(ctx, conversation.id, conversation.since))
      if (moved.length > 0) yield* phase({ _tag: 'catching-up', done: ++done, total: moved.length })
      yield* Effect.yieldNow
    }
    if (options.refreshThreads) {
      // A warm boot reads the whole window and checks the follows it left out; a reconnect only what moved since the last sync.
      const until = options.refreshWorkspace ? start : maxTs(start, millisToTs(previous.lastSyncAt))
      yield* loadThreadViews(ctx, { until, probe: options.refreshWorkspace, lane: 'interactive' })
    }
    const discovered = yield* discoverOrLog(discoverSince(ctx, previous.lastSyncAt, counts.entries, {}))
    if (options.recheck !== undefined) yield* recheck(ctx, options.recheck)
    if (options.recheck !== undefined) yield* queueRepairs(ctx, counts.entries, options.recheck.since)
    else if (options.observeSweepMarkers !== undefined) yield* options.observeSweepMarkers(counts.entries)
    yield* fillUsers(ctx)
    const state: BootState = {
      ...(previous.quietDays === undefined ? {} : { quietDays: previous.quietDays }),
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      lastSyncAt: discovered ? startedAt : previous.lastSyncAt,
    }
    if (options.persistState !== false) yield* transaction(setSyncState(BOOT_KEY, state))
    return state
  })

/** The warm boot: `catchUp` with a workspace refresh, and the recheck for the time the app was closed. */
export const warmBoot = (ctx: SyncContext, previous: BootState, phase: Phase, first: ReadonlyArray<string>): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* phase({ _tag: 'booting' })
    yield* catchUp(ctx, previous, phase, { refreshWorkspace: true, refreshThreads: true, recheck: { since: previous.lastSyncAt, first } })
  })
