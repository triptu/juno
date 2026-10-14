/**
 * What the topic view needs from the running sync, as top-level modules
 * see it: the fetcher for opened topics, and the set of topics on screen.
 *
 * A top-level module, like `sessionClient.ts`, because the session feature
 * runs the sync (`session/SyncRunner.ts`) and the messages feature uses it,
 * and feature folders do not import each other. The runner hands the sync's
 * `TopicFetcher` in when a sync starts and takes it back when it ends; the
 * messages handlers mark a topic as shown while its header is subscribed,
 * and the sync fetches those topics again after a reconnect.
 */
import { Context, Effect, Layer, Ref, Stream, SubscriptionRef, type Scope } from 'effect'
import type { TopicFetcher } from '@juno/sync'

export class SyncLink extends Context.Service<
  SyncLink,
  {
    /** The running sync's fetcher; `undefined` while no sync runs (signed out, or before the session is ready). */
    readonly fetcher: Effect.Effect<TopicFetcher | undefined>
    readonly setFetcher: (fetcher: TopicFetcher | undefined) => Effect.Effect<void>
    /** Marks a topic as shown for the life of the scope. */
    readonly showing: (topicId: string) => Effect.Effect<void, never, Scope.Scope>
    /** The topics shown now, most recently shown first. */
    readonly shown: Effect.Effect<ReadonlyArray<string>>
    /** `shown` at subscribe time, then every change. */
    readonly shownChanges: Stream.Stream<ReadonlyArray<string>>
  }
>()('juno/engine/SyncLink') {
  static readonly layer: Layer.Layer<SyncLink> = Layer.effect(
    SyncLink,
    Effect.gen(function* () {
      const current = yield* Ref.make<TopicFetcher | undefined>(undefined)
      // Topic id to the number of subscriptions showing it. A Map keeps insertion order; a new subscription moves it last.
      const counts = new Map<string, number>()
      const listed = () => [...counts.keys()].toReversed()
      const changes = yield* SubscriptionRef.make<ReadonlyArray<string>>([])
      const publish = Effect.suspend(() => SubscriptionRef.set(changes, listed()))
      const showing = (topicId: string) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const n = counts.get(topicId) ?? 0
            counts.delete(topicId)
            counts.set(topicId, n + 1)
          }).pipe(Effect.andThen(publish)),
          () =>
            Effect.sync(() => {
              const n = (counts.get(topicId) ?? 1) - 1
              if (n <= 0) counts.delete(topicId)
              else counts.set(topicId, n)
            }).pipe(Effect.andThen(publish)),
        )
      return SyncLink.of({
        fetcher: Ref.get(current),
        setFetcher: (fetcher) => Ref.set(current, fetcher),
        showing,
        shown: Effect.sync(listed),
        shownChanges: SubscriptionRef.changes(changes),
      })
    }),
  )
}
