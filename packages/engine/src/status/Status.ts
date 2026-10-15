/**
 * Process-level status: the phase the engine is in and when it started.
 *
 * Later milestones move the phase through booting, catching-up, live,
 * offline and so on; `setPhase` is the one way to do it, so the live query
 * sees every change. `setSyncing` says whether a sync cycle is running.
 */
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import type { EnginePhase, EngineStatus } from '@juno/contract'

export class Status extends Context.Service<
  Status,
  {
    readonly current: Effect.Effect<EngineStatus>
    readonly setPhase: (phase: EnginePhase) => Effect.Effect<void>
    readonly setSyncing: (syncing: boolean) => Effect.Effect<void>
    /** Emits the current phase at subscribe time, then every change. */
    readonly phases: Stream.Stream<EnginePhase>
    /** Emits once at subscribe time, then on every change of the phase or of `syncing`. */
    readonly changes: Stream.Stream<void>
  }
>()('juno/engine/Status') {
  static readonly layer = Layer.effect(
    Status,
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis
      const phase = yield* SubscriptionRef.make<EnginePhase>({ _tag: 'booting' })
      const syncing = yield* SubscriptionRef.make(false)
      const current = Effect.gen(function* () {
        return { phase: yield* SubscriptionRef.get(phase), startedAt, syncing: yield* SubscriptionRef.get(syncing) }
      })
      return Status.of({
        current,
        setPhase: (next) => SubscriptionRef.set(phase, next),
        setSyncing: (next) => SubscriptionRef.set(syncing, next),
        phases: SubscriptionRef.changes(phase),
        changes: Stream.zipLatest(SubscriptionRef.changes(phase), SubscriptionRef.changes(syncing)).pipe(Stream.as(undefined)),
      })
    }),
  )
}
