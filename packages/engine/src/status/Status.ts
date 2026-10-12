/**
 * Process-level status: the phase the engine is in and when it started.
 *
 * Later milestones move the phase through booting, catching-up, live,
 * offline and so on; `setPhase` is the one way to do it, so the live query
 * sees every change.
 */
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import type { EnginePhase, EngineStatus } from '@juno/contract'

export class Status extends Context.Service<
  Status,
  {
    readonly current: Effect.Effect<EngineStatus>
    readonly setPhase: (phase: EnginePhase) => Effect.Effect<void>
    /** Emits the current phase at subscribe time, then every change. */
    readonly phases: Stream.Stream<EnginePhase>
  }
>()('juno/engine/Status') {
  static readonly layer = Layer.effect(
    Status,
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis
      const phase = yield* SubscriptionRef.make<EnginePhase>({ _tag: 'booting' })
      const current = Effect.map(SubscriptionRef.get(phase), (value) => ({ phase: value, startedAt }))
      return Status.of({
        current,
        setPhase: (next) => SubscriptionRef.set(phase, next),
        phases: SubscriptionRef.changes(phase),
      })
    }),
  )
}
