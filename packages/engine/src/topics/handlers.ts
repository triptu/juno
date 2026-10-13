/**
 * Handlers for the topic routes. Both live queries follow the open
 * workspace: with none open they serve an empty window, and when one opens
 * (or a sign-out closes it) they switch to its store, so a renderer that
 * subscribed before the session was ready sees the rows arrive.
 *
 * The sidebar query re-runs on `topics`, the overlay, conversations, users,
 * the ignored list, Slack's follow flags and prefs (the quiet window), and
 * once a minute so a topic can turn quiet on time.
 *
 * The two commands (`commands.ts`) write the current store and mirror to
 * Slack through the `Outbox` seam.
 */
import { Clock, Effect, Result, Schedule, Schema, Stream } from 'effect'
import { TopicRow, TopicsRoutes, type TopicCounts } from '@juno/contract'
import { invalidate, liveQuery, type InvalidationKeys } from '@juno/store'
import { EngineConfig } from '../config'
import { Outbox } from '../outbox'
import { serveLiveList, serveLiveValue, timed, type ListRun, type Run } from '../protocol/live'
import { Workspace } from '../workspace'
import { setSubscribed } from './commands'
import { countTopics, listTopics } from './query'

/** The sidebar holds at most this many rows (performance 3.2). */
export const SIDEBAR_WINDOW = 300

const LIST_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'users', 'ignored_channels', 'thread_subs', 'prefs']
const COUNT_KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'conversations', 'ignored_channels', 'thread_subs']
const QUIET_TICK = '1 minute'

const encodeRow = Schema.encodeSync(Schema.toCodecJson(TopicRow))

export const TopicsHandlers = TopicsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev

    /** Query runs from the current store, or one empty run while no workspace is open. */
    const runs = <A>(keys: InvalidationKeys, query: Effect.Effect<A, never, never>, empty: A, tick: boolean) =>
      workspace.changes.pipe(
        Stream.switchMap((open) =>
          open === undefined
            ? Stream.succeed(Result.succeed({ value: empty, queryMs: 0 }) as Run<A, never>)
            : Stream.scoped(
                liveQuery(keys, timed(query)).pipe(
                  Stream.provide(open.context),
                  tick
                    ? (stream) =>
                        Stream.unwrap(
                          Effect.gen(function* () {
                            yield* Effect.forkScoped(
                              Effect.repeat(invalidate(['topics']).pipe(Effect.provide(open.context)), Schedule.spaced(QUIET_TICK)),
                            )
                            return stream
                          }),
                        )
                    : (stream) => stream,
                ),
              ),
        ),
      )

    return {
      'topics.list': (payload) => {
        const limit = Math.max(1, Math.min(SIDEBAR_WINDOW, payload.range.limit))
        const filter = { kind: payload.kind, unreadOnly: payload.unreadOnly, scope: payload.scope }
        const query = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* listTopics(filter, { now, limit })
        }).pipe(Effect.orDie)
        return serveLiveList(runs(LIST_KEYS, query as Effect.Effect<ListRun<TopicRow>, never, never>, { rows: [], total: 0 }, true), { encodeRow, measure })
      },
      'topics.counts': (payload) => {
        const query = countTopics(payload.scope).pipe(Effect.orDie)
        return serveLiveValue(runs(COUNT_KEYS, query as Effect.Effect<TopicCounts, never, never>, { channelsUnread: 0, dmsUnread: 0 }, false), { measure })
      },
      'topics.subscribe': (payload) => setSubscribed(payload.id, true).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
      'topics.unsubscribe': (payload) => setSubscribed(payload.id, false).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox)),
    }
  }),
)
