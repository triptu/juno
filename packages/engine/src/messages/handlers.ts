/**
 * Handlers for the topic view's routes (`contract/src/routes/messages.ts`).
 *
 * The three live queries follow the open workspace like the sidebar's
 * (`topics/handlers.ts`) and never call Slack, so a prefetch costs one local
 * query. Their keys:
 * - `messages.list`: the topic's messages and reactions (`{ messages: [id] }`,
 *   which every message write fires for each topic that shows the message),
 *   Main also listens to channel messages and thread coverage for first-reply previews.
 *   `users`, `conversations` and `emoji` supply body names and images,
 *   `team` the signed-in user;
 * - `topics.get`: its index row, overlay, art and read state by id, the
 *   conversation, the follow flags, users and prefs, and for Main every
 *   topic (its thread count);
 * - `channel.threads`: topics, overlays, users, prefs and art.
 *
 * A `topics.get` subscription marks its topic as shown in `SyncLink`, so a
 * reconnect fetches it again. The two commands run the sync's fetcher on
 * the interactive lane and report Slack's answer as an outcome, never as a
 * failure: the topic shows what the store has.
 */
import { Clock, Effect, Schema, type Scope, Semaphore, Stream } from 'effect'
import {
  MESSAGE_WINDOW_BEFORE,
  MESSAGE_WINDOW_MAX,
  MessagesRoutes,
  MessageView,
  NotFound,
  NotSignedIn,
  THREADS_WINDOW_MAX,
  ThreadSummary,
  type FetchOutcome,
} from '@juno/contract'
import { mainTopicId, parseTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import type { SlackApiError } from '@juno/slack'
import { Invalidation, liveQuery, StoreReader, type InvalidationKeys, type SqlError } from '@juno/store'
import type { FetchReport } from '@juno/sync'
import { pendingThread, resolveStartedThread } from '../startedThreads'
import { personFrom, type UserRow } from '../topicRows'
import { placeLabel } from '../placeLabel'
import { EngineConfig } from '../config'
import { retryFirstRun, serveLiveList, serveLiveValue, timed, type Run } from '../protocol/live'
import { SyncLink } from '../syncLink'
import { Workspace, type StoreServices } from '../workspace'
import { channelThreads, topicDetail } from './detail'
import { forgetLookups, listMessages, makeMessageCache } from './query'
import type { WindowTarget } from './window'

const encodeMessage = Schema.encodeSync(Schema.toCodecJson(MessageView))
const encodeThread = Schema.encodeSync(Schema.toCodecJson(ThreadSummary))

/** The window a topic id names, or `undefined` for anything else (groups come later). */
const targetOf = (id: string): WindowTarget | undefined => {
  const pending = pendingThread(id)
  if (pending !== undefined) return { kind: 'thread', channel: pending.channel, threadTs: `pending:${pending.clientMsgId}` }
  const parsed = parseTopicId(id)
  if (parsed === undefined) return undefined
  return parsed.kind === 'thread' ? { kind: 'thread', channel: parsed.channel, threadTs: parsed.threadTs } : { kind: 'main', channel: parsed.channel }
}

/** Slack's answer as the contract says it (architecture 2.6). A decode or store error is a bug and dies. */
export const outcomeOf = (error: SlackApiError | SqlError): Effect.Effect<FetchOutcome> => {
  switch (error._tag) {
    case 'SlackTransportError':
      return Effect.succeed('offline')
    case 'SlackRateLimited':
      return Effect.succeed('rate-limited')
    case 'SlackAuthRequired':
      return Effect.succeed('signed-out')
    case 'SlackRejected':
      return Effect.succeed('rejected')
    default:
      return Effect.die(error)
  }
}

export const MessagesHandlers = MessagesRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const link = yield* SyncLink
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev

    /** Query runs from the current store, as in `topics/handlers.ts`: nothing while no workspace is open. */
    const runs = <A>(
      keys: InvalidationKeys,
      setup: Effect.Effect<Effect.Effect<A, SqlError, StoreServices>, never, StoreServices | Scope.Scope>,
    ): Stream.Stream<Run<A, SqlError>> =>
      workspace.changes.pipe(
        Stream.switchMap((open) => {
          if (open === undefined) return Stream.empty
          const opened = Effect.gen(function* () {
            const query = yield* setup
            const lane = Semaphore.makeUnsafe(1)
            return liveQuery(keys, lane.withPermit(timed(query)))
          })
          return Stream.scoped(Stream.unwrap(opened).pipe(Stream.provide(open.context)))
        }),
      )

    const now = Clock.currentTimeMillis

    /** Runs a fetch of the running sync. Without one (signed out, or the session not ready) nothing can be fetched. */
    const fetch = (run: (fetcher: NonNullable<Effect.Success<typeof link.fetcher>>) => Effect.Effect<FetchReport, SlackApiError | SqlError>) =>
      Effect.gen(function* () {
        const fetcher = yield* link.fetcher
        if (fetcher === undefined) return { outcome: 'signed-out' as FetchOutcome, report: undefined }
        const result = yield* Effect.result(run(fetcher))
        if (result._tag === 'Success') return { outcome: (result.success.fetched ? 'fetched' : 'cached') as FetchOutcome, report: result.success }
        return { outcome: yield* outcomeOf(result.failure), report: undefined }
      })

    return {
      'messages.list': (payload) => {
        const target = targetOf(payload.id)
        if (target === undefined) return Stream.die(new Error(`messages.list: ${payload.id} is not a topic id`))
        const range = {
          anchor: payload.range.anchor,
          before: Math.max(0, payload.before ?? MESSAGE_WINDOW_BEFORE),
          limit: Math.max(1, Math.min(MESSAGE_WINDOW_MAX, payload.range.limit)),
        }
        const keys: InvalidationKeys = { messages: target.kind === 'main' || pendingThread(payload.id) !== undefined ? [payload.id, `channel:${target.channel}`] : [payload.id], users: [], conversations: [], usergroups: [], emoji: [], team: [], sync_state: [], synced_ranges: [target.channel], thread_cursors: target.kind === 'main' ? [] : [payload.id] }
        const setup = Effect.gen(function* () {
          const cache = makeMessageCache()
          const invalidation = yield* Invalidation
          // Names and emoji are looked up per body; drop them before the run the same change triggers.
          yield* Effect.acquireRelease(
            Effect.sync(() => invalidation.subscribeUnsafe(['users', 'conversations', 'usergroups', 'emoji'], () => forgetLookups(cache))),
            (cancel) => Effect.sync(cancel),
          )
          // An app's or a deactivated person's DM with no Main yet: when that one Main row is written, look again and run
          // again, so their name starts to open it. Only those rows; the list does not listen to every topic.
          const watched = new Map<string, () => void>()
          cache.watchMain = (topicId) => {
            if (watched.has(topicId)) return
            watched.set(topicId, invalidation.subscribeUnsafe({ topics: [topicId] }, () => {
              forgetLookups(cache)
              Effect.runSync(invalidation.invalidate({ messages: [payload.id] }))
            }))
          }
          const titleWatches = new Map<string, () => void>()
          cache.watchBroadcastTitles = (ids) => {
            const current = new Set(ids)
            for (const [id, cancel] of titleWatches) if (!current.has(id)) {
              cancel()
              titleWatches.delete(id)
            }
            for (const id of current) if (!titleWatches.has(id)) {
              titleWatches.set(id, invalidation.subscribeUnsafe({ topic_overlay: [id] }, () => {
                Effect.runSync(invalidation.invalidate({ messages: [payload.id] }))
              }))
            }
          }
          yield* Effect.addFinalizer(() => Effect.sync(() => {
            watched.forEach((cancel) => cancel())
            titleWatches.forEach((cancel) => cancel())
          }))
          return Effect.flatMap(resolveStartedThread(payload.id), id => listMessages(targetOf(id)!, range, cache))
        })
        return serveLiveList(runs(keys, setup), { encodeRow: encodeMessage, measure }).pipe(retryFirstRun('messages.list'), Stream.orDie)
      },
      'topics.get': (payload) => {
        const target = targetOf(payload.id)
        if (target === undefined) return Stream.die(new Error(`topics.get: ${payload.id} is not a topic id`))
        const keys: InvalidationKeys =
          target.kind === 'main'
            ? ['topics', 'conversations', 'thread_subs', 'users', 'prefs', 'team', 'ignored_channels', 'topic_overlay', 'topic_reads', 'topic_art']
            : { topics: pendingThread(payload.id) === undefined ? [payload.id] : [], topic_overlay: pendingThread(payload.id) === undefined ? [payload.id] : [], topic_reads: pendingThread(payload.id) === undefined ? [payload.id] : [], conversations: [], thread_subs: [], users: [], prefs: [], team: [], messages: pendingThread(payload.id) === undefined ? [payload.id] : [`channel:${target.channel}`], topic_art: [] }
        const setup = Effect.succeed(Effect.flatMap(now, at => Effect.flatMap(resolveStartedThread(payload.id), id => topicDetail(id, targetOf(id)!, at))))
        const served = serveLiveValue(runs(keys, setup), { measure }).pipe(retryFirstRun('topics.get'), Stream.orDie)
        // Shown for as long as the header is subscribed.
        return pendingThread(payload.id) === undefined ? Stream.unwrap(Effect.as(link.showing(payload.id), served)) : served
      },
      'channel.threads': (payload) => {
        const limit = Math.max(1, Math.min(THREADS_WINDOW_MAX, payload.range.limit))
        const keys: InvalidationKeys = ['topics', 'topic_overlay', 'users', 'prefs', 'conversations', 'topic_art']
        const setup = Effect.succeed(Effect.flatMap(now, (at) => channelThreads(payload.channel, limit, at, payload.all === true)))
        return serveLiveList(runs(keys, setup), { encodeRow: encodeThread, measure }).pipe(retryFirstRun('channel.threads'), Stream.orDie)
      },
      'topics.open': (payload) =>
        Effect.gen(function* () {
          if (targetOf(payload.id) === undefined) return yield* new NotFound({ kind: 'topic', id: payload.id })
          if (pendingThread(payload.id) !== undefined) return { outcome: 'cached' as const }
          const { outcome } = yield* fetch((fetcher) => fetcher.open(payload.id))
          return { outcome }
        }),
      'messages.locate': ({ channel, ts, threadTs }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          const { row, place } = yield* Effect.gen(function* () {
            const sql = yield* StoreReader
            const rows = ts === undefined ? [] : yield* sql<{ thread_ts: string | null; reply_count: number }>`SELECT thread_ts, reply_count FROM messages WHERE channel = ${channel} AND ts = ${ts}`
            return { row: rows[0], place: yield* placeLabel(channel) }
          }).pipe(Effect.provide(open.context), Effect.orDie)
          // A link may name the thread; else a reply names its thread, and a root with replies is its own thread's first message.
          const thread = (threadTs !== undefined && threadTs !== ts ? threadTs : undefined) ?? row?.thread_ts ?? (row !== undefined && row.reply_count > 0 ? ts : undefined)
          const topicId = thread === undefined ? mainTopicId(channel as ChannelId) : threadTopicId(channel as ChannelId, thread as Ts)
          return { topicId, stored: row !== undefined, ...(place === undefined ? {} : { place }) }
        }),
      'people.locate': ({ user }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          return yield* Effect.gen(function* () {
            const sql = yield* StoreReader
            const users = yield* sql<UserRow & { deleted: 0 | 1 }>`SELECT id, name, COALESCE(NULLIF(real_name, ''), NULLIF(display_name, '')) AS display_name, real_name, avatar_url, avatar_small_url, avatar_large_url, deleted FROM users WHERE id = ${user}`
            if (users[0] === undefined) return {}
            const dms = yield* sql<{ id: string }>`SELECT d.id FROM conversations d WHERE d.kind = 'im' AND d.user_id = ${user} AND d.is_member = 1
              AND EXISTS (SELECT 1 FROM topic_index t WHERE t.topic_id = 'm:' || d.id) ORDER BY d.id LIMIT 1`
            // A deactivated person's DM can still be read; with none, there is nothing to open.
            if (dms[0] === undefined && users[0].deleted === 1) return {}
            return { person: personFrom(user, users[0]), ...(dms[0] === undefined ? {} : { mainId: mainTopicId(dms[0].id as ChannelId) }) }
          }).pipe(Effect.provide(open.context), Effect.orDie)
        }),
      'messages.loadOlder': (payload) =>
        Effect.gen(function* () {
          if (targetOf(payload.id) === undefined) return yield* new NotFound({ kind: 'topic', id: payload.id })
          if (pendingThread(payload.id) !== undefined) return { outcome: 'cached' as const, complete: true }
          const { outcome, report } = yield* fetch((fetcher) => fetcher.older(payload.id, payload.before))
          return { outcome, complete: report?.complete ?? false }
        }),
    }
  }),
)
