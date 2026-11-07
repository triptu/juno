/**
 * Handlers for the topic routes. Both live queries follow the open
 * workspace: while none is open they send nothing, so a renderer that
 * subscribed before the session was ready keeps whatever it shows until the
 * rows arrive, and when the workspace opens (or a sign-out closes it) they
 * switch to its store.
 *
 * The sidebar query re-runs on `topics`, the overlay, conversations, users,
 * the ignored list, Slack's follow flags, prefs (the quiet window, AI
 * assist) and the art table, and
 * once a minute for its own subscription so a topic can turn quiet on time.
 * Each subscription keeps a `RowCache` per workspace, so a run reshapes
 * only the rows whose inputs changed and reads only the users it has not
 * read since the `users` table last changed.
 *
 * Errors: a failed query run is a value from the store's `liveQuery`, and
 * the serve helpers re-emit the last message with `meta.error`, so a busy
 * reader or a bad migration never ends a subscription. A failure before the
 * first value has nothing to re-emit, so the subscription starts again with
 * backoff and the renderer keeps what it shows until a run succeeds.
 *
 * The follow commands (`../follow.ts`, shared with notifications) write the current store and mirror
 * to Slack through the `Outbox` seam. Follow new threads (`../followNew.ts`) is a local setting; its
 * job makes the follows. The topic actions (`actions.ts`) are
 * local; a resolve that queued a read mark wakes `MarkWorker`.
 */
import { Clock, Effect, Schema, type Scope, Stream } from 'effect'
import { ALL_TOPICS_WINDOW, AllTopicsRoutes, SIDEBAR_WINDOW, TopicListRow, TopicsRoutes, type CommandResult } from '@juno/contract'
import { Invalidation, liveQuery, type InvalidationKeys, type SqlError } from '@juno/store'
import { EngineConfig } from '../config'
import { MarkWorker } from '../markWorker'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveList, serveLiveValue, timed, type Run } from '../protocol/live'
import { observeLiveRead, WorkControl } from '../workControl'
import { Workspace, type StoreServices } from '../workspace'
import { keepSuggested, keepTopicOpen, renameTopic, reopenTopic, resolveTopic, restoreTopic, setChannelIgnored, setPinned } from '../topicActions'
import { listAllTopics, matchQuery, summarizeAllTopics } from './allTopics'
import { setSubscribed } from '../follow'
import { setFollowNew } from '../followNew'
import { countTopics, forgetUsergroups, forgetUsers, listTopics, makeRowCache } from './query'
import { listIgnorableChannels, listIgnoredChannels } from './ignored'

const LIST_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'topic_reads', 'conversations', 'users', 'usergroups', 'ignored_channels', 'thread_subs', 'prefs', 'topic_art']
/** The sidebar list and counts also follow the views (a view's conversations and Keep these out of All) and the first sync's holds. All topics does not. */
const SIDEBAR_KEYS: InvalidationKeys = [...LIST_KEYS, 'sidebar_views', 'automated_holds', 'sync_state']
const COUNT_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'ignored_channels', 'thread_subs', 'sidebar_views', 'automated_holds']
const QUIET_TICK = '1 minute'
/** The ignore list counts the messages each channel hid, so it follows them too. */
const IGNORED_KEYS: InvalidationKeys = ['ignored_channels', 'conversations', 'messages']

const IGNORABLE_KEYS: InvalidationKeys = ['ignored_channels', 'conversations']

const encodeRow = Schema.encodeSync(Schema.toCodecJson(TopicListRow))

/**
 * Query runs from the current store; nothing while no workspace is open.
 * `setup` runs once per open workspace, in a scope that lasts as long as
 * the workspace does, and returns the query. With `tick`, the query also
 * runs once a minute so a topic turns quiet on time; only this
 * subscription re-runs. The minute is one more trigger of the live query,
 * so its runs and the change runs share one loop: runs never overlap, and
 * a run that read older rows never sends after one that read newer rows.
 */
function liveRuns<A>(
  workspace: Workspace['Service'],
  route: string,
  keys: InvalidationKeys,
  setup: Effect.Effect<Effect.Effect<A, SqlError, StoreServices>, never, StoreServices | Scope.Scope>,
  tick: boolean,
): Stream.Stream<Run<A, SqlError>> {
  return workspace.changes.pipe(
    Stream.switchMap((open) => {
      if (open === undefined) return Stream.empty
      const opened = Effect.gen(function* () {
        const control = yield* WorkControl
        const query = observeLiveRead(route, yield* setup, control)
        // `Stream.tick` emits at once; the live query already runs at subscribe time.
        const minutes = Stream.tick(QUIET_TICK).pipe(Stream.drop(1), Stream.tap(() => Effect.sync(() => control.onLiveRun?.(route, 'tick'))))
        return liveQuery(keys, timed(query), { triggers: tick ? minutes : undefined })
      })
      return Stream.scoped(Stream.unwrap(opened).pipe(Stream.provide(open.context)))
    }),
  )
}

/** A row cache for one subscription that forgets the users or groups it read whenever their table changes. */
const rowCacheForSubscription = Effect.gen(function* () {
  const cache = makeRowCache({ keepUsers: true })
  const invalidation = yield* Invalidation
  yield* Effect.acquireRelease(
    Effect.sync(() => invalidation.subscribeUnsafe(['users'], () => forgetUsers(cache))),
    (cancel) => Effect.sync(cancel),
  )
  yield* Effect.acquireRelease(
    Effect.sync(() => invalidation.subscribeUnsafe(['usergroups'], () => forgetUsergroups(cache))),
    (cancel) => Effect.sync(cancel),
  )
  return cache
})

export const TopicsHandlers = TopicsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const config = yield* EngineConfig
    const worker = yield* MarkWorker
    const measure = config.e2e || config.dev

    /** Runs a topic action in the open workspace and wakes the worker when it queued a mark. */
    const act = <E>(effect: Effect.Effect<{ readonly result: CommandResult; readonly queued: boolean }, E, Workspace | EngineConfig>) =>
      effect.pipe(
        Effect.provideService(Workspace, workspace),
        Effect.provideService(EngineConfig, config),
        Effect.tap(({ queued }) => (queued ? worker.wake : Effect.void)),
        Effect.map(({ result }) => result),
      )

    const runs = <A>(route: string, keys: InvalidationKeys, setup: Effect.Effect<Effect.Effect<A, SqlError, StoreServices>, never, StoreServices | Scope.Scope>, tick: boolean) =>
      liveRuns(workspace, route, keys, setup, tick)

    return {
      'topics.list': (payload) => {
        const limit = Math.max(1, Math.min(SIDEBAR_WINDOW, payload.range.limit))
        const filter = { kind: payload.kind, unreadOnly: payload.unreadOnly, scope: payload.scope, view: payload.view }
        // One row cache per workspace. It keeps the users it has read until the `users` table changes.
        const setup = Effect.gen(function* () {
          const cache = yield* rowCacheForSubscription
          return Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            return yield* listTopics(filter, { now, limit }, cache)
          })
        })
        return serveLiveList(runs('topics.list', SIDEBAR_KEYS, setup, true), { encodeRow, measure }).pipe(retryFirstRun('topics.list'), Stream.orDie)
      },
      'topics.counts': (payload) =>
        serveLiveValue(runs('topics.counts', COUNT_KEYS, Effect.succeed(countTopics(payload.scope)), false), { measure }).pipe(retryFirstRun('topics.counts'), Stream.orDie),
      'topics.subscribe': (payload) => setSubscribed(payload.id, true).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
      'topics.unsubscribe': (payload) => setSubscribed(payload.id, false).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
      'topics.resolve': ({ id }) => act(resolveTopic(id)),
      'topics.keepOpen': ({ id }) => act(keepTopicOpen(id)),
      'topics.keepSuggested': ({ id, suggestion }) => act(keepSuggested(id, suggestion)),
      'topics.reopen': ({ id }) => act(reopenTopic(id)),
      'topics.pin': ({ id }) => act(setPinned(id, true)),
      'topics.unpin': ({ id }) => act(setPinned(id, false)),
      'topics.rename': ({ id, title }) => act(renameTopic(id, title)),
      'topics.restore': ({ id, overlay, unreadFrom }) => act(restoreTopic(id, overlay, unreadFrom)),
      'channels.ignore': ({ channel }) => setChannelIgnored(channel, true).pipe(Effect.provideService(Workspace, workspace)),
      'channels.unignore': ({ channel }) => setChannelIgnored(channel, false).pipe(Effect.provideService(Workspace, workspace)),
      'channels.followNew': ({ channel, on, since }) => setFollowNew(channel, on, since).pipe(Effect.provideService(Workspace, workspace)),
      'channels.ignored': () =>
        serveLiveValue(runs('channels.ignored', IGNORED_KEYS, Effect.succeed(listIgnoredChannels), false), { measure }).pipe(retryFirstRun('channels.ignored'), Stream.orDie),
      'channels.ignorable': () =>
        serveLiveValue(runs('channels.ignorable', IGNORABLE_KEYS, Effect.succeed(listIgnorableChannels), false), { measure }).pipe(retryFirstRun('channels.ignorable'), Stream.orDie),
    }
  }),
)

/** A text filter searches messages, so its runs follow them too. */
const allTopicsKeys = (query: string | undefined): InvalidationKeys => [...LIST_KEYS, 'sync_state', ...(matchQuery(query) === '' ? [] : ['messages'] as const)]

/**
 * All topics (`allTopics.ts`). Both routes re-run on what the sidebar list
 * re-runs on, plus `messages` while a text filter searches them, and once a
 * minute so a topic turns quiet on time. Each list subscription is one
 * window with its own row cache.
 */
export const AllTopicsHandlers = AllTopicsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'allTopics.list': ({ range, offset, ...filter }) => {
        const limit = Math.max(1, Math.min(ALL_TOPICS_WINDOW, range.limit))
        const setup = Effect.map(rowCacheForSubscription, (cache) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) => listAllTopics(filter, { now, offset, limit }, cache)),
        )
        return serveLiveList(liveRuns(workspace, 'allTopics.list', allTopicsKeys(filter.query), setup, true), { encodeRow, measure }).pipe(retryFirstRun('allTopics.list'), Stream.orDie)
      },
      'allTopics.summary': (narrowing) => {
        const setup = Effect.succeed(Effect.flatMap(Clock.currentTimeMillis, (now) => summarizeAllTopics(narrowing, now)))
        return serveLiveValue(liveRuns(workspace, 'allTopics.summary', allTopicsKeys(narrowing.query), setup, true), { measure }).pipe(retryFirstRun('allTopics.summary'), Stream.orDie)
      },
    }
  }),
)
