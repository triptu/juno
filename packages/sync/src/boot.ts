/**
 * Cold boot, warm boot and the catch-up after a reconnect (architecture
 * 5.2, 5.8). Every page lands through `applyPage`, so the merge rules and
 * `reindexTopics` run the same way whatever brought the data.
 *
 * Cold boot, in order: `client.userBoot` and `users.prefs.get`,
 * `client.counts`, the followed threads from `subscriptions.thread.getView`
 * (10 per page live, paged back to the quiet window), one history page per active conversation (newest first,
 * background lane, skipping conversations an interrupted boot already
 * covered), unknown users from the edge, a latest-reply fetch for the
 * unfollowed threads with the most recent activity so their rows have a
 * preview, and the discovery sweep over the window so Main knows about
 * replies to roots older than the window.
 *
 * Warm boot: `client.userBoot`, a full `client.counts` (membership is
 * derived from it), history since the synced range for conversations whose
 * `latest` moved, `getView` back to the window, the discovery sweep for
 * the gap, users. The reconnect catch-up and the sweep are the same without
 * the workspace refresh, with `counts_last_fetched`, and with `getView` back
 * to the last moment the store was in step. `followPass` reads the followed
 * threads over the window and checks the follows it left out; `runSync`
 * schedules it.
 */
import { compareTs, maxTs, millisToTs, type Me, type Ts, type UsergroupId } from '@juno/domain'
import { SlackApi, type SlackApiError, type SlackAuthRequired } from '@juno/slack'
import { SlackEdge, SlackSession } from '@juno/slack'
import type { Channel, ClientCountsArgs, CountEntry, Message, ThreadView } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { discoverSince } from './discovery'
import { recheck, type RecheckOptions } from './recheck'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'
import { reindexTopics } from './reindex'
import { fillUsers } from './users'
import {
  addSyncedRange,
  getSyncState,
  latestSyncedRange,
  markRepliesComplete,
  observeRead,
  readState,
  replaceMembership,
  seedTopicRead,
  setChannelReads,
  setMembership,
  setSyncState,
  setThreadSub,
  threadMessages,
  toConversationRow,
  upsertConversations,
  upsertTeam,
  upsertUsers,
} from './write'

export const BOOT_KEY = 'boot'
/** `sync_state.me`: the user and their user groups, so a command outside the sync re-indexes with the same mention rules. */
export const ME_KEY = 'me'

/** What `sync_state.boot` records once a boot completes. */
export interface BootState {
  readonly completedAt: number
  readonly countsLastFetched?: number
  /** The last moment the store was known to be in step with Slack; discovery sweeps and the reconnect `getView` start here. */
  readonly lastSyncAt: number
}

export type Phase = (phase: { _tag: 'booting' } | { _tag: 'catching-up'; done: number; total: number }) => Effect.Effect<void>

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
const loadWorkspace = (ctx: SyncContext, withPrefs: boolean): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const boot = yield* api.call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, { lane: 'interactive', reason: 'fetch-client-data' })
    const prefs = withPrefs ? (yield* api.call('users.prefs.get', {}, { lane: 'interactive', reason: 'prefs' })).prefs : (boot.prefs ?? undefined)
    const selfId = ctx.me.userId
    ctx.me = { userId: selfId, usergroupIds: (boot.subteams?.self ?? []) as ReadonlyArray<UsergroupId> }
    yield* transaction(
      Effect.gen(function* () {
        yield* upsertTeam(boot.team, selfId, prefs, undefined)
        yield* setSyncState(ME_KEY, ctx.me)
        yield* upsertUsers([boot.self])
        yield* upsertConversations([...boot.channels.map((c) => toConversationRow(c)), ...boot.ims.map((im) => toConversationRow(im))])
      }),
    )
  })

/**
 * `client.counts`: which conversations the user is in, Slack's read pointers
 * and unread flags for each, and the first read pointer of every Main.
 * Without `counts_last_fetched` the list is complete and membership is
 * replaced by it; with it the entries only add members (what the server
 * leaves out of an incremental answer is Unknown, research section 2). An
 * entry for a conversation the store has never seen (joined while the
 * socket was down) is fetched with `conversations.info` first, so the
 * membership write has a row to land on.
 */
const loadCounts = (ctx: SyncContext, sinceFetched: number | undefined): Effect.Effect<{ entries: ReadonlyArray<CountEntry>; fetched: number | undefined }, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const args: ClientCountsArgs = { thread_counts_by_channel: true, ...(sinceFetched === undefined ? {} : { counts_last_fetched: sinceFetched }) }
    // The time before the call: a `*_marked` event that lands while counts is in flight is newer than the answer.
    const now = yield* Clock.currentTimeMillis
    const requestedAt = millisToTs(now)
    const counts = yield* api.call('client.counts', args, { lane: 'interactive', reason: 'counts' })
    const entries = [...counts.channels, ...counts.ims, ...counts.mpims]
    const unknown = yield* unknownConversations(entries.map((e) => e.id))
    const fetched: Array<Channel> = []
    for (const id of unknown) {
      const info = yield* api.call('conversations.info', { channel: id }, { lane: 'interactive', reason: 'conversation' }).pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
      if (info !== undefined) fetched.push(info.channel)
    }
    yield* transaction(
      Effect.gen(function* () {
        const ids = entries.map((e) => e.id)
        if (fetched.length > 0) yield* upsertConversations(fetched.map((c) => toConversationRow(c)))
        if (sinceFetched === undefined) yield* replaceMembership(ids)
        else yield* setMembership(ids, true)
        yield* setChannelReads(entries, now)
        // A pointer Juno has never seen is Slack's; a known one applies when Slack's changed (specs/readstate.qnt).
        for (const entry of entries) {
          const outcome = yield* observeRead(mainTopicOf(entry.id), { kind: 'page', lastReadTs: entry.last_read, requestedAt })
          if (outcome === 'applied') yield* reindexTopics([mainTopicOf(entry.id)], reindexOptions(ctx))
          if (outcome === 'lookup') yield* Queue.offer(ctx.readLookups, entry.id)
        }
      }),
    )
    return { entries, fetched: counts.counts_last_fetched }
  })

/** Ids among `ids` with no `conversations` row. */
const unknownConversations = (ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (ids.length === 0) return []
    const sql = yield* StoreWriter
    const known = new Set<string>()
    for (let i = 0; i < ids.length; i += 500) {
      const rows = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id IN ${sql.in(ids.slice(i, i + 500))}`
      for (const row of rows) known.add(row.id)
    }
    return ids.filter((id) => !known.has(id))
  })

interface Active {
  readonly id: string
  readonly latest: Ts
}

/** Member conversations with activity inside the window, newest first. */
const activeConversations = (entries: ReadonlyArray<CountEntry>, start: Ts): Effect.Effect<ReadonlyArray<Active>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const members = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1 AND is_archived = 0`
    const memberIds = new Set(members.map((m) => m.id))
    return entries
      .filter((e): e is CountEntry & { latest: Ts } => typeof e.latest === 'string' && memberIds.has(e.id) && e.latest >= start)
      .map((e) => ({ id: e.id, latest: e.latest }))
      .toSorted((a, b) => (a.latest > b.latest ? -1 : a.latest < b.latest ? 1 : 0))
  })

/** One thread from `getView`: root, unread and latest replies, Slack's subscription and read pointer. */
const applyThreadView = (ctx: SyncContext, view: ThreadView, requestedAt: Ts): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const root = view.root_msg
    const channel = root.channel
    const seen = new Map<string, Message>()
    // Slack omits unread_replies when nothing in the thread is unread.
    for (const reply of [...(view.latest_replies ?? []), ...(view.unread_replies ?? [])]) seen.set(reply.ts, reply)
    const topic = threadTopicOf(channel, root.ts)
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
    // The view carries every unread reply, so coverage is complete from Slack's read pointer on.
    const completeFrom = root.last_read ?? root.latest_reply ?? root.ts
    yield* transaction(markRepliesComplete(channel, root.ts, replies >= root.reply_count, yield* Clock.currentTimeMillis, completeFrom))
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
  options: { readonly until: Ts; readonly probe: boolean; readonly lane: 'interactive' | 'background' },
): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const listed = new Set<string>()
    let firstRequestedAt: Ts | undefined
    let current: Ts | undefined
    // `until` when the pages stopped there; undefined when they reached the end of the list.
    let coveredFrom: Ts | undefined = options.until
    while (true) {
      const requestedAt = yield* nowTs
      firstRequestedAt ??= requestedAt
      const page = yield* api.call(
        'subscriptions.thread.getView',
        { limit: ctx.config.getViewPageLimit, ...(current === undefined ? {} : { current_ts: current }) },
        { lane: options.lane, reason: 'threads' },
      )
      for (const view of page.threads) {
        listed.add(`${view.root_msg.channel}:${view.root_msg.ts}`)
        yield* applyThreadView(ctx, view, requestedAt)
      }
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
    yield* loadThreadViews(ctx, { until: windowStart, probe: true, lane: 'background' })
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
    const followed = yield* sql<{ channel: string; thread_ts: string; observed_at: string | null; activity: string }>`
      SELECT s.channel, s.thread_ts, s.observed_at, COALESCE(m.latest_reply, m.ts, s.thread_ts) AS activity
      FROM thread_subs s JOIN conversations c ON c.id = s.channel
      LEFT JOIN messages m ON m.channel = s.channel AND m.ts = s.thread_ts
      WHERE s.subscribed = 1 AND c.is_member = 1`
    for (const row of followed) {
      if (listed.has(`${row.channel}:${row.thread_ts}`)) continue
      if (coveredFrom !== undefined && compareTs(row.activity, coveredFrom) < 0) continue
      if (compareTs(row.activity, listRequestedAt) >= 0) continue
      if (row.observed_at !== null && compareTs(row.observed_at, listRequestedAt) >= 0) continue
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
      oldestSeen = page.messages.at(-1)?.ts ?? oldestSeen
      cursor = page.response_metadata?.next_cursor
      complete = !page.has_more || cursor === undefined || cursor === ''
      yield* transaction(addSyncedRange(channel, complete || oldestSeen === undefined ? since : oldestSeen, requestedAt))
      yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [mainTopicOf(channel)] })
      if (complete) break
      yield* Effect.yieldNow
    }
  })

/** Rows for unfollowed threads discovered through history have only the root; fetch the latest reply for a preview. */
const loadThreadPreviews = (ctx: SyncContext, seedReadBefore: string): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const api = yield* SlackApi
    const roots = yield* sql<{ channel: string; root_ts: string; latest_reply: string | null }>`
      SELECT i.channel, i.root_ts, m.latest_reply FROM topic_index i
        JOIN messages m ON m.channel = i.channel AND m.ts = i.root_ts
        WHERE i.kind = 'thread' AND m.reply_count > 0
          AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.channel = i.channel AND r.thread_ts = i.root_ts AND r.ts <> i.root_ts)
        ORDER BY i.last_activity_ts DESC LIMIT ${ctx.config.previewThreads}`
    for (const root of roots) {
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
    yield* phase({ _tag: 'booting' })
    const startedAt = yield* Clock.currentTimeMillis
    // Unfollowed threads count as read up to here; a reply during the boot stays unread.
    const bootTs = millisToTs(startedAt)
    const windowStart = yield* windowStartMillis(ctx)
    const start = millisToTs(windowStart)
    yield* loadWorkspace(ctx, true)
    const counts = yield* loadCounts(ctx, undefined)
    yield* loadThreadViews(ctx, { until: start, probe: true, lane: 'interactive' })
    const active = yield* activeConversations(counts.entries, start)
    yield* phase({ _tag: 'catching-up', done: 0, total: active.length })
    let done = 0
    for (const conversation of active) {
      // A boot that failed half way left ranges behind; what they cover is not fetched again.
      if (!(yield* covered(conversation.id, start, conversation.latest))) yield* skipRejected(loadHistoryWindow(ctx, conversation.id, start, { seedReadBefore: bootTs }))
      yield* phase({ _tag: 'catching-up', done: ++done, total: active.length })
      yield* Effect.yieldNow
    }
    yield* fillUsers(ctx)
    yield* loadThreadPreviews(ctx, bootTs)
    // Replies inside the window to roots older than it: Main's activity, which windowed history cannot see.
    const discovered = yield* discoverOrLog(discoverSince(ctx, windowStart, counts.entries, { seedReadBefore: bootTs }))
    yield* fillUsers(ctx)
    const state: BootState = {
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      // A failed discovery leaves the gap for the next sweep to search again.
      lastSyncAt: discovered ? startedAt : windowStart,
    }
    yield* transaction(setSyncState(BOOT_KEY, state))
  })

export interface CatchUpOptions {
  /** Refresh team, conversations and self first, and take the full counts list (warm boot: yes; reconnect: no). */
  readonly refreshWorkspace: boolean
  /** Page the followed threads with activity since the window (warm boot) or `lastSyncAt` (reconnect). */
  readonly refreshThreads: boolean
  /** Read the likely topics again for changes made during a gap (`recheck.ts`): after a drop or a restart, not on a sweep. */
  readonly recheck?: RecheckOptions
}

/**
 * Brings a populated cache up to date: counts, history since the synced
 * ranges where `latest` moved, the followed threads with activity since the
 * store was last in step, the discovery sweep for the gap since `since`,
 * after a gap the recheck of the likely topics, and unknown users. Used by
 * the warm boot and after every reconnect.
 */
export const catchUp = (ctx: SyncContext, previous: BootState, phase: Phase, options: CatchUpOptions): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const start = millisToTs(yield* windowStartMillis(ctx))
    if (options.refreshWorkspace) yield* loadWorkspace(ctx, false)
    // A full list after a workspace refresh, so a channel left while the app was closed drops out.
    const counts = yield* loadCounts(ctx, options.refreshWorkspace ? undefined : previous.countsLastFetched)
    const active = yield* activeConversations(counts.entries, start)
    const moved: Array<{ id: string; since: string | undefined }> = []
    for (const conversation of active) {
      const range = yield* latestSyncedRange(conversation.id)
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
    yield* fillUsers(ctx)
    const state: BootState = {
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      lastSyncAt: discovered ? startedAt : previous.lastSyncAt,
    }
    yield* transaction(setSyncState(BOOT_KEY, state))
  })

/** The warm boot: `catchUp` with a workspace refresh, and the recheck for the time the app was closed. */
export const warmBoot = (ctx: SyncContext, previous: BootState, phase: Phase, first: ReadonlyArray<string>): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* phase({ _tag: 'booting' })
    yield* catchUp(ctx, previous, phase, { refreshWorkspace: true, refreshThreads: true, recheck: { since: previous.lastSyncAt, first } })
  })
