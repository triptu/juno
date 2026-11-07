/**
 * The handler of `reactions.feed` (`contract/src/routes/reactionFeed.ts`).
 *
 * The query (`reactionFeed.ts`) re-runs on `reaction_feed` and on the
 * tables a row is shaped from. While it is subscribed, a fiber in the
 * subscription's scope reads Slack's feed each time the sync's socket is
 * connected, the first time included, so the view catches up when it opens
 * and after a reconnect and never polls.
 *
 * A run that finds rows whose message the store lacks asks the sync to read
 * them, each once per connection: a read that fails is logged, the others
 * go on, and it is asked again after the socket reconnects. Messages the
 * store has are kept current by the sync (the socket, and its repair after
 * a gap), so they cost no call here. A failed feed read is logged; the
 * stored rows stay.
 */
import { Clock, Effect, Scope, Stream } from 'effect'
import { ReactionFeedRoutes } from '@juno/contract'
import { Invalidation, liveQuery, StoreReader, type InvalidationKeys } from '@juno/store'
import { EngineConfig } from '../config'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'
import { outcomeOf } from './handlers'
import { readReactionFeed } from './reactionFeed'

const KEYS: InvalidationKeys = ['reaction_feed', 'messages', 'users', 'conversations', 'emoji', 'team', 'ignored_channels', 'topic_overlay']

/** Any message write anywhere re-runs the query, so its runs are spaced a little more than the default. */
const DEBOUNCE = '150 millis'

const logFailure = (what: string) => (error: Parameters<typeof outcomeOf>[0]) =>
  outcomeOf(error).pipe(Effect.flatMap((outcome) => Effect.logWarning(`reactions.feed: ${what}`, { outcome })))

export const ReactionFeedHandlers = ReactionFeedRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const link = yield* SyncLink
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'reactions.feed': () => {
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            const opened = Effect.gen(function* () {
              const scope = yield* Scope.Scope
              const sql = yield* StoreReader
              const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`.pipe(Effect.orElseSucceed(() => [])))[0]?.self_user_id ?? undefined
              // Rows asked for since the socket last connected. Nothing is asked before the first connection's feed read.
              let connected = false
              const asked = new Set<string>()
              yield* Effect.forkIn(
                link.onlineChanges.pipe(
                  Stream.filter((online) => online),
                  Stream.runForEach(() =>
                    Effect.gen(function* () {
                      const fetcher = yield* link.fetcher
                      if (fetcher === undefined) return
                      yield* fetcher.reactionFeed.pipe(Effect.catch(logFailure('the feed was not read')))
                      connected = true
                      asked.clear()
                      yield* (yield* Invalidation).invalidate(['reaction_feed'])
                    }),
                  ),
                ),
                scope,
              )
              const query = Effect.gen(function* () {
                const run = yield* readReactionFeed(selfId, yield* Clock.currentTimeMillis)
                const wanted = connected ? run.missing.filter((ref) => !asked.has(`${ref.channel}:${ref.ts}`)) : []
                const fetcher = wanted.length === 0 ? undefined : yield* link.fetcher
                if (fetcher !== undefined) {
                  for (const ref of wanted) asked.add(`${ref.channel}:${ref.ts}`)
                  const readAll = Effect.forEach(wanted, (ref) => fetcher.feedMessage(ref.channel, ref.ts).pipe(Effect.catch(logFailure('a message was not read'))), { discard: true })
                  yield* Effect.forkIn(readAll, scope)
                }
                return run.rows
              })
              return liveQuery(KEYS, timed(query), { debounce: DEBOUNCE })
            })
            return Stream.scoped(Stream.unwrap(opened).pipe(Stream.provide(open.context)))
          }),
        )
        return serveLiveValue(runs, { measure }).pipe(retryFirstRun('reactions.feed'), Stream.orDie)
      },
    }
  }),
)
