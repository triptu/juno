/**
 * Waiting for a time on the wall clock. A timer counts time the process
 * runs, so it stops while the Mac sleeps and fires late after, and a
 * change to the wall clock moves the deadline under it. `sleepUntil`
 * reads the clock again after its timer fires and after each wake of the
 * Mac (main's `wake`), and waits again for what is left, so a pause that
 * ends at 11:11pm ends then, or at the wake after it.
 */
import { Clock, Context, Deferred, Effect, Layer, Stream } from 'effect'
import { HostLink } from './protocol/host'

export class SystemWake extends Context.Service<SystemWake, {
  /** Completes at the next wake of the Mac. */
  readonly next: Effect.Effect<void>
}>()('juno/engine/SystemWake') {
  static readonly layer: Layer.Layer<SystemWake, never, HostLink> = Layer.effect(SystemWake, Effect.gen(function* () {
    const link = yield* HostLink
    const messages = yield* link.messages
    let pending = Deferred.makeUnsafe<void>()
    yield* Effect.forkScoped(Stream.runForEach(messages, (message) => Effect.sync(() => {
      if (message._tag !== 'wake') return
      const woken = pending
      pending = Deferred.makeUnsafe<void>()
      Deferred.doneUnsafe(woken, Effect.void)
    })))
    return SystemWake.of({ next: Effect.suspend(() => Deferred.await(pending)) })
  }))
}

/** Waits until the wall clock reaches `deadline` (epoch milliseconds), checking again after each timer and each wake. */
export const sleepUntil = (deadline: number): Effect.Effect<void, never, SystemWake> => Effect.gen(function* () {
  const wake = yield* SystemWake
  while (true) {
    const now = yield* Clock.currentTimeMillis
    if (now >= deadline) return
    yield* Effect.raceFirst(Effect.sleep(deadline - now), wake.next)
  }
})
