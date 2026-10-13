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
 * The two commands (`commands.ts`) write the current store and mirror to
 * Slack through the `Outbox` seam.
 */
import { Clock, Effect, Schema, type Scope, Semaphore, Stream } from 'effect'
import { SIDEBAR_WINDOW, TopicListRow, TopicsRoutes } from '@juno/contract'
import { Invalidation, liveQuery, type InvalidationKeys, type SqlError } from '@juno/store'
import { EngineConfig } from '../config'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveList, serveLiveValue, timed, type Run } from '../protocol/live'
import { Workspace, type StoreServices } from '../workspace'
import { setSubscribed } from './commands'
import { countTopics, forgetUsers, listTopics, makeRowCache } from './query'

const LIST_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels', 'thread_subs', 'prefs', 'topic_art']
const COUNT_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'ignored_channels', 'thread_subs']
const QUIET_TICK = '1 minute'

const encodeRow = Schema.encodeSync(Schema.toCodecJson(TopicListRow))

export const TopicsHandlers = TopicsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev

    /**
     * Query runs from the current store; nothing while no workspace is open.
     * `setup` runs once per open workspace, in a scope that lasts as long as
     * the workspace does, and returns the query. With `tick`, the query also
     * runs once a minute so a topic turns quiet on time; only this
     * subscription re-runs. Runs of one subscription never overlap, so a
     * later run's value is never sent before an earlier one's.
     */
    const runs = <A>(
      keys: InvalidationKeys,
      setup: Effect.Effect<Effect.Effect<A, SqlError, StoreServices>, never, StoreServices | Scope.Scope>,
      tick: boolean,
    ): Stream.Stream<Run<A, SqlError>> =>
      workspace.changes.pipe(
        Stream.switchMap((open) => {
          if (open === undefined) return Stream.empty
          const opened = Effect.gen(function* () {
            const query = yield* setup
            const lane = Semaphore.makeUnsafe(1)
            const run = lane.withPermit(timed(query))
            const live = liveQuery(keys, run)
            // `Stream.tick` emits at once; the live query already runs at subscribe time.
            const ticks = Stream.tick(QUIET_TICK).pipe(Stream.drop(1), Stream.mapEffect(() => Effect.result(run)))
            return tick ? Stream.merge(live, ticks) : live
          })
          return Stream.scoped(Stream.unwrap(opened).pipe(Stream.provide(open.context)))
        }),
      )

    return {
      'topics.list': (payload) => {
        const limit = Math.max(1, Math.min(SIDEBAR_WINDOW, payload.range.limit))
        const filter = { kind: payload.kind, unreadOnly: payload.unreadOnly, scope: payload.scope }
        // One row cache per workspace. It keeps the users it has read until the `users` table changes.
        const setup = Effect.gen(function* () {
          const cache = makeRowCache({ keepUsers: true })
          const invalidation = yield* Invalidation
          yield* Effect.acquireRelease(
            Effect.sync(() => invalidation.subscribeUnsafe(['users'], () => forgetUsers(cache))),
            (cancel) => Effect.sync(cancel),
          )
          return Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            return yield* listTopics(filter, { now, limit }, cache)
          })
        })
        return serveLiveList(runs(LIST_KEYS, setup, true), { encodeRow, measure }).pipe(retryFirstRun('topics.list'), Stream.orDie)
      },
      'topics.counts': (payload) =>
        serveLiveValue(runs(COUNT_KEYS, Effect.succeed(countTopics(payload.scope)), false), { measure }).pipe(retryFirstRun('topics.counts'), Stream.orDie),
      'topics.subscribe': (payload) => setSubscribed(payload.id, true).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
      'topics.unsubscribe': (payload) => setSubscribed(payload.id, false).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
    }
  }),
)
