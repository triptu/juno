/**
 * What the topic view needs from the running sync, as top-level modules
 * see it: the fetcher for opened topics, and the set of topics on screen.
 *
 * A top-level module, like `sessionClient.ts`, because the session feature
 * runs the sync (`session/SyncRunner.ts`) and the messages feature uses it,
 * and feature folders do not import each other. The runner hands the sync's
 * `TopicFetcher` in when a sync starts and takes it back when it ends; the
 * messages handlers mark a topic as shown while its header is subscribed,
 * and the sync fetches those topics again after a reconnect. The runner
 * also says when a boot or catch-up has finished, which is when the send
 * outbox flushes (architecture 5.8), and whether the sync's socket is
 * connected: the outbox workers send nothing while it is not, so a send
 * made offline waits for the connection instead of failing into a lookup.
 */
import { Context, Effect, Layer, PubSub, Ref, Stream, SubscriptionRef, type Scope } from 'effect'
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
    /** Called by the runner when a boot, catch-up or sweep has finished. */
    readonly caughtUp: Effect.Effect<void>
    /** One element each time `caughtUp` is called after subscribing. */
    readonly caughtUps: Stream.Stream<void>
    /** Whether a sync runs and its socket is connected. */
    readonly online: Effect.Effect<boolean>
    readonly setOnline: (online: boolean) => Effect.Effect<void>
    /** `online` at subscribe time, then every change. */
    readonly onlineChanges: Stream.Stream<boolean>
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
      const cycles = yield* PubSub.sliding<void>(1)
      const online = yield* SubscriptionRef.make(false)
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
        caughtUp: Effect.asVoid(PubSub.publish(cycles, undefined)),
        caughtUps: Stream.fromPubSub(cycles),
        online: SubscriptionRef.get(online),
        setOnline: (next) => SubscriptionRef.set(online, next),
        onlineChanges: Stream.changes(SubscriptionRef.changes(online)),
      })
    }),
  )
}
