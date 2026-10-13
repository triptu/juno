/**
 * Cold boot, warm boot and the catch-up after a reconnect (architecture
 * 5.2, 5.8). Every page lands through `applyPage`, so the merge rules and
 * `reindexTopics` run the same way whatever brought the data.
 *
 * Cold boot, in order: `client.userBoot` and `users.prefs.get`,
 * `client.counts`, the followed threads from `subscriptions.thread.getView`
 * (paged until the roots are older than the quiet window), one history page
 * per active conversation (newest first, background lane), unknown users
 * from the edge, then a latest-reply fetch for the unfollowed threads with
 * the most recent activity so their rows have a preview.
 *
 * Warm boot: `client.userBoot`, `client.counts` with `counts_last_fetched`,
 * history since the synced range for conversations whose `latest` moved, the
 * first `getView` page, the discovery sweep for the gap, users.
 */
import { millisToTs, type Ts } from '@juno/domain'
import { SlackApi, type SlackApiError } from '@juno/slack'
import { SlackEdge, SlackSession } from '@juno/slack'
import type { ClientCountsArgs, CountEntry, ThreadView } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { discoverSince } from './discovery'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'
import { reindexTopics } from './reindex'
import { fillUsers } from './users'
import {
  addSyncedRange,
  applyServerMark,
  getSyncState,
  latestSyncedRange,
  markRepliesComplete,
  seedTopicRead,
  setChannelReads,
  setSyncState,
  setThreadSub,
  threadMessages,
  toConversationRow,
  upsertConversations,
  upsertTeam,
  upsertUsers,
} from './write'

export const BOOT_KEY = 'boot'

/** What `sync_state.boot` records once a boot completes. */
export interface BootState {
  readonly completedAt: number
  readonly countsLastFetched?: number
  /** The last moment the store was known to be in step with Slack; discovery sweeps start here. */
  readonly lastSyncAt: number
}

export type Phase = (phase: { _tag: 'booting' } | { _tag: 'catching-up'; done: number; total: number }) => Effect.Effect<void>

export type BootError = SlackApiError | SqlError
export type BootServices = SlackApi | SlackEdge | SlackSession | StoreWriter | Invalidation

const DAY = 24 * 60 * 60 * 1000

export const bootState = (): Effect.Effect<BootState | undefined, SqlError, StoreWriter> => getSyncState<BootState>(BOOT_KEY)

const windowStart = (ctx: SyncContext) => Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now - ctx.config.quietDays * DAY))
const nowTs = Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))

/** `client.userBoot`: team, self, conversations. `prefs` only on a cold boot. */
const loadWorkspace = (ctx: SyncContext, withPrefs: boolean): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const boot = yield* api.call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, { lane: 'interactive', reason: 'fetch-client-data' })
    const prefs = withPrefs ? (yield* api.call('users.prefs.get', {}, { lane: 'interactive', reason: 'prefs' })).prefs : (boot.prefs ?? undefined)
    const selfId = ctx.me.userId
    yield* transaction(
      Effect.gen(function* () {
        yield* upsertTeam(boot.team, selfId, prefs, undefined)
        yield* upsertUsers([boot.self])
        yield* upsertConversations([
          ...boot.channels.map((c) => toConversationRow(c, selfId)),
          ...boot.ims.map((im) => toConversationRow(im, selfId)),
        ])
      }),
    )
  })

/** `client.counts`: Slack's read pointers and unread flags per conversation, and the first read pointer of every Main. */
const loadCounts = (ctx: SyncContext, sinceFetched: number | undefined): Effect.Effect<{ entries: ReadonlyArray<CountEntry>; fetched: number | undefined }, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const args: ClientCountsArgs = { thread_counts_by_channel: true, ...(sinceFetched === undefined ? {} : { counts_last_fetched: sinceFetched }) }
    const counts = yield* api.call('client.counts', args, { lane: 'interactive', reason: 'counts' })
    const entries = [...counts.channels, ...counts.ims, ...counts.mpims]
    const now = yield* Clock.currentTimeMillis
    const eventTs = millisToTs(now)
    yield* transaction(
      Effect.gen(function* () {
        yield* setChannelReads(entries, now)
        // A pointer Juno has never seen is Slack's; a known one is a server mark that may have been missed.
        for (const entry of entries) {
          yield* seedTopicRead(mainTopicOf(entry.id), entry.last_read)
          if (yield* applyServerMark(mainTopicOf(entry.id), entry.last_read, eventTs)) yield* reindexTopics([mainTopicOf(entry.id)], reindexOptions(ctx))
        }
      }),
    )
    return { entries, fetched: counts.counts_last_fetched }
  })

interface Active {
  readonly id: string
  readonly latest: string
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
    const seen = new Map<string, (typeof view.latest_replies)[number]>()
    // Slack omits unread_replies when nothing in the thread is unread.
    for (const reply of [...view.latest_replies, ...(view.unread_replies ?? [])]) seen.set(reply.ts, reply)
    const topic = threadTopicOf(channel, root.ts)
    yield* transaction(
      Effect.gen(function* () {
        yield* setThreadSub(channel, root.ts, root.subscribed ?? true, root.last_read)
        yield* seedTopicRead(topic, root.last_read ?? root.latest_reply ?? root.ts)
        if (root.last_read !== undefined) yield* applyServerMark(topic, root.last_read, requestedAt)
      }),
    )
    yield* applyPage(ctx, channel, [root, ...seen.values()], { kind: 'page', requestedAt })
    const stored = yield* threadMessages(channel, root.ts)
    const replies = stored.filter((m) => m.ts !== root.ts && m.deleted === 0).length
    // The view carries every unread reply, so coverage is complete from Slack's read pointer on.
    const completeFrom = root.last_read ?? root.latest_reply ?? root.ts
    yield* transaction(markRepliesComplete(channel, root.ts, replies >= root.reply_count, yield* Clock.currentTimeMillis, completeFrom))
  })

/** Followed threads, newest first, until the page's oldest root is outside the window (`all: false` stops after one page). */
const loadThreadViews = (ctx: SyncContext, start: Ts, all: boolean): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    let current: Ts | undefined
    while (true) {
      const requestedAt = yield* nowTs
      const page = yield* api.call(
        'subscriptions.thread.getView',
        { limit: ctx.config.getViewPageLimit, ...(current === undefined ? {} : { current_ts: current }) },
        { lane: 'interactive', reason: 'threads' },
      )
      for (const view of page.threads) yield* applyThreadView(ctx, view, requestedAt)
      const last = page.threads.at(-1)
      const lastActivity = last?.root_msg.latest_reply ?? last?.root_msg.ts
      if (!all || !page.has_more || lastActivity === undefined || lastActivity < start) return
      current = lastActivity
      yield* Effect.yieldNow
    }
  })

/** The newest history page of a conversation inside the window. Records the range it covered. */
const loadHistoryWindow = (ctx: SyncContext, channel: string, start: Ts): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = yield* nowTs
    const page = yield* api.call(
      'conversations.history',
      { channel, oldest: start, inclusive: true, limit: ctx.config.historyPageLimit, ignore_replies: true, no_user_profile: true },
      { lane: 'background', reason: 'history' },
    )
    // The range first, so the index of this page already knows what history covers.
    const oldest = page.messages.at(-1)?.ts
    yield* transaction(addSyncedRange(channel, page.has_more && oldest !== undefined ? oldest : start, requestedAt))
    yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, [mainTopicOf(channel)])
  })

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
      yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, [mainTopicOf(channel)])
      if (complete) break
      yield* Effect.yieldNow
    }
  })

/** Rows for unfollowed threads discovered through history have only the root; fetch the latest reply for a preview. */
const loadThreadPreviews = (ctx: SyncContext): Effect.Effect<void, BootError, BootServices> =>
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
      yield* applyPage(ctx, root.channel, page.messages, { kind: 'page', requestedAt })
      yield* Effect.yieldNow
    }
  })

/** Everything Slack knows about the workspace, into an empty cache (architecture 5.2). */
export const coldBoot = (ctx: SyncContext, phase: Phase): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* phase({ _tag: 'booting' })
    const startedAt = yield* Clock.currentTimeMillis
    const start = yield* windowStart(ctx)
    yield* loadWorkspace(ctx, true)
    const counts = yield* loadCounts(ctx, undefined)
    yield* loadThreadViews(ctx, start, true)
    const active = yield* activeConversations(counts.entries, start)
    yield* phase({ _tag: 'catching-up', done: 0, total: active.length })
    ctx.seedNewThreadsAsRead = true
    let done = 0
    for (const conversation of active) {
      yield* loadHistoryWindow(ctx, conversation.id, start)
      yield* phase({ _tag: 'catching-up', done: ++done, total: active.length })
      yield* Effect.yieldNow
    }
    yield* fillUsers(ctx)
    yield* loadThreadPreviews(ctx)
    ctx.seedNewThreadsAsRead = false
    const state: BootState = {
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      lastSyncAt: startedAt,
    }
    yield* transaction(setSyncState(BOOT_KEY, state))
  })

export interface CatchUpOptions {
  /** Refresh team, conversations and self first (warm boot: yes; reconnect: no). */
  readonly refreshWorkspace: boolean
  /** Fetch the first page of followed threads again. */
  readonly refreshThreads: boolean
}

/**
 * Brings a populated cache up to date: counts, history since the synced
 * ranges where `latest` moved, the first `getView` page, the discovery sweep
 * for the gap since `since`, and unknown users. Used by the warm boot and
 * after every reconnect.
 */
export const catchUp = (ctx: SyncContext, previous: BootState, phase: Phase, options: CatchUpOptions): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const start = yield* windowStart(ctx)
    if (options.refreshWorkspace) yield* loadWorkspace(ctx, false)
    const counts = yield* loadCounts(ctx, previous.countsLastFetched)
    const active = yield* activeConversations(counts.entries, start)
    const moved: Array<{ id: string; since: string | undefined }> = []
    for (const conversation of active) {
      const range = yield* latestSyncedRange(conversation.id)
      if (range === undefined || conversation.latest > range.to_ts) moved.push({ id: conversation.id, since: range?.to_ts })
    }
    if (moved.length > 0) yield* phase({ _tag: 'catching-up', done: 0, total: moved.length })
    let done = 0
    for (const conversation of moved) {
      if (conversation.since === undefined) yield* loadHistoryWindow(ctx, conversation.id, start)
      else yield* loadHistorySince(ctx, conversation.id, conversation.since)
      if (moved.length > 0) yield* phase({ _tag: 'catching-up', done: ++done, total: moved.length })
      yield* Effect.yieldNow
    }
    if (options.refreshThreads) yield* loadThreadViews(ctx, start, false)
    yield* discoverSince(ctx, previous.lastSyncAt, counts.entries)
    yield* fillUsers(ctx)
    const state: BootState = {
      completedAt: yield* Clock.currentTimeMillis,
      ...(counts.fetched === undefined ? {} : { countsLastFetched: counts.fetched }),
      lastSyncAt: startedAt,
    }
    yield* transaction(setSyncState(BOOT_KEY, state))
  })

/** The warm boot: `catchUp` with a workspace refresh. */
export const warmBoot = (ctx: SyncContext, previous: BootState, phase: Phase): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* phase({ _tag: 'booting' })
    yield* catchUp(ctx, previous, phase, { refreshWorkspace: true, refreshThreads: true })
  })
