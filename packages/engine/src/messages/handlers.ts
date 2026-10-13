/**
 * Handlers for the topic view's routes (`contract/src/routes/messages.ts`).
 *
 * The three live queries follow the open workspace like the sidebar's
 * (`topics/handlers.ts`) and never call Slack, so a prefetch costs one local
 * query. Their keys:
 * - `messages.list`: the topic's messages and reactions (`{ messages: [id] }`,
 *   which every message write fires for each topic that shows the message),
 *   `users`, `conversations` and `emoji` for the names and images bodies
 *   use, `topic_overlay` for thread titles, `team` for the signed-in user;
 * - `topics.get`: its index row, overlay and read state by id, the
 *   conversation, the follow flags, users and prefs, and for Main every
 *   topic (its thread count);
 * - `channel.threads`: topics, overlays, follow flags, users and prefs.
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
  THREADS_WINDOW_MAX,
  ThreadSummary,
  type FetchOutcome,
} from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import type { SlackApiError } from '@juno/slack'
import { Invalidation, liveQuery, type InvalidationKeys, type SqlError } from '@juno/store'
import type { FetchReport } from '@juno/sync'
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
  const parsed = parseTopicId(id)
  if (parsed === undefined || parsed.kind === 'group') return undefined
  return parsed.kind === 'thread' ? { kind: 'thread', channel: parsed.channel, threadTs: parsed.threadTs } : { kind: 'main', channel: parsed.channel }
}

/** Slack's answer as the contract says it (architecture 2.6). A decode or store error is a bug and dies. */
const outcomeOf = (error: SlackApiError | SqlError): Effect.Effect<FetchOutcome> => {
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
        const keys: InvalidationKeys = { messages: [payload.id], users: [], conversations: [], emoji: [], topic_overlay: [], team: [] }
        const setup = Effect.gen(function* () {
          const cache = makeMessageCache()
          const invalidation = yield* Invalidation
          // Names and emoji are looked up per body; drop them before the run the same change triggers.
          yield* Effect.acquireRelease(
            Effect.sync(() => invalidation.subscribeUnsafe(['users', 'conversations', 'emoji'], () => forgetLookups(cache))),
            (cancel) => Effect.sync(cancel),
          )
          return listMessages(target, range, cache)
        })
        return serveLiveList(runs(keys, setup), { encodeRow: encodeMessage, measure }).pipe(retryFirstRun('messages.list'), Stream.orDie)
      },
      'topics.get': (payload) => {
        const target = targetOf(payload.id)
        if (target === undefined) return Stream.die(new Error(`topics.get: ${payload.id} is not a topic id`))
        const keys: InvalidationKeys =
          target.kind === 'main'
            ? ['topics', 'conversations', 'thread_subs', 'users', 'prefs', 'team', 'ignored_channels', 'topic_overlay', 'topic_reads']
            : { topics: [payload.id], topic_overlay: [payload.id], topic_reads: [payload.id], conversations: [], thread_subs: [], users: [], prefs: [], team: [], messages: [payload.id] }
        const setup = Effect.succeed(Effect.flatMap(now, (at) => topicDetail(payload.id, target, at)))
        const served = serveLiveValue(runs(keys, setup), { measure }).pipe(retryFirstRun('topics.get'), Stream.orDie)
        // Shown for as long as the header is subscribed.
        return Stream.unwrap(Effect.as(link.showing(payload.id), served))
      },
      'channel.threads': (payload) => {
        const limit = Math.max(1, Math.min(THREADS_WINDOW_MAX, payload.range.limit))
        const keys: InvalidationKeys = ['topics', 'topic_overlay', 'thread_subs', 'users', 'prefs', 'conversations']
        const setup = Effect.succeed(Effect.flatMap(now, (at) => channelThreads(payload.channel, limit, at)))
        return serveLiveList(runs(keys, setup), { encodeRow: encodeThread, measure }).pipe(retryFirstRun('channel.threads'), Stream.orDie)
      },
      'topics.open': (payload) =>
        Effect.gen(function* () {
          if (targetOf(payload.id) === undefined) return yield* new NotFound({ kind: 'topic', id: payload.id })
          const { outcome } = yield* fetch((fetcher) => fetcher.open(payload.id))
          return { outcome }
        }),
      'messages.loadOlder': (payload) =>
        Effect.gen(function* () {
          if (targetOf(payload.id) === undefined) return yield* new NotFound({ kind: 'topic', id: payload.id })
          const { outcome, report } = yield* fetch((fetcher) => fetcher.older(payload.id, payload.before))
          return { outcome, complete: report?.complete ?? false }
        }),
    }
  }),
)
