/**
 * The handler of `reactions.who` (`contract/src/routes/whoReacted.ts`).
 *
 * The query (`reactors.ts`) re-runs on the message's topics and its channel
 * (`{ messages: [...] }`, which reaction writes and the outbox fire), on
 * `users`, `emoji` and `team`, and on its own key, which the full fetch
 * fires when it ends so `loading` clears even when nothing was stored.
 *
 * The first value is what the store holds. When a reaction lists fewer
 * people than its count, the subscription asks the running sync's fetcher
 * for everyone once (`TopicFetcher.reactors`, interactive lane), forked in
 * the subscription's scope so the value is not held back; closing the dialog
 * interrupts it. A failure is logged and leaves the stored list. People the
 * store lacks are asked for through `wantUsers`, once each per subscription.
 */
import { Effect, Scope, Stream } from 'effect'
import { WhoReactedRoutes } from '@juno/contract'
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Invalidation, liveQuery, StoreReader, type InvalidationKeys } from '@juno/store'
import { EngineConfig } from '../config'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'
import { whoReacted } from './reactors'

export const WhoReactedHandlers = WhoReactedRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const link = yield* SyncLink
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'reactions.who': ({ channel, ts }) => {
        const own: InvalidationKeys = { reactors: [`${channel}:${ts}`] }
        const runs = workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            const opened = Effect.gen(function* () {
              const scope = yield* Scope.Scope
              const invalidation = yield* Invalidation
              const sql = yield* StoreReader
              // The message's topics: the outbox fires only those for the user's own reactions.
              const rows = yield* sql<{ thread_ts: string | null }>`SELECT thread_ts FROM messages WHERE channel = ${channel} AND ts = ${ts}`.pipe(Effect.orElseSucceed(() => []))
              const thread = (rows[0]?.thread_ts ?? ts) as Ts
              const keys: InvalidationKeys = { messages: [mainTopicId(channel as ChannelId), threadTopicId(channel as ChannelId, thread), `channel:${channel}`], ...own, users: [], emoji: [], team: [] }
              let fetched = false
              let loading = false
              const asked = new Set<string>()
              const query = Effect.gen(function* () {
                const run = yield* whoReacted(channel, ts)
                if (run.value === null) return null
                const fetcher = yield* link.fetcher
                const unnamed = run.unknown.filter((id) => !asked.has(id))
                if (unnamed.length > 0 && fetcher !== undefined) {
                  for (const id of unnamed) asked.add(id)
                  yield* fetcher.wantUsers(unnamed)
                }
                if (run.short && !fetched && fetcher !== undefined) {
                  fetched = true
                  loading = true
                  yield* Effect.forkIn(
                    fetcher.reactors(channel, ts).pipe(
                      Effect.catchCause((cause) => Effect.logWarning('reactions.who: the full list was not fetched', { cause })),
                      Effect.ensuring(
                        Effect.suspend(() => {
                          loading = false
                          return invalidation.invalidate(own)
                        }),
                      ),
                    ),
                    scope,
                  )
                }
                return { ...run.value, loading }
              })
              return liveQuery(keys, timed(query))
            })
            return Stream.scoped(Stream.unwrap(opened).pipe(Stream.provide(open.context)))
          }),
        )
        return serveLiveValue(runs, { measure }).pipe(retryFirstRun('reactions.who'), Stream.orDie)
      },
    }
  }),
)
