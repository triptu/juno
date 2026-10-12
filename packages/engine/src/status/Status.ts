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
    /** Emits whenever the phase changes. Does not emit the current value first. */
    readonly phaseChanges: Stream.Stream<EnginePhase>
  }
>()('juno/engine/Status') {
  static readonly layer = Layer.effect(
    Status,
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis
      const phase = yield* SubscriptionRef.make<EnginePhase>({ _tag: 'booting' })
      const current = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        return { phase: yield* SubscriptionRef.get(phase), uptime: now - startedAt, startedAt }
      })
      return Status.of({
        current,
        setPhase: (next) => SubscriptionRef.set(phase, next),
        phaseChanges: SubscriptionRef.changes(phase).pipe(Stream.drop(1)),
      })
    }),
  )
}
