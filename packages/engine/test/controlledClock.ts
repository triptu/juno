import { Clock, Effect, Exit, Scope } from 'effect'
import { TestClock } from 'effect/testing'

/** Boots with live I/O, then freezes engine time for a scheduling assertion. */
export async function controlledClock() {
  const scope = Effect.runSync(Scope.make())
  const test = await Effect.runPromise(TestClock.make().pipe(Effect.provideService(Scope.Scope, scope)))
  const live = Effect.runSync(Clock.Clock)
  let current: Clock.Clock = live
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => current.currentTimeMillisUnsafe(),
    currentTimeNanosUnsafe: () => current.currentTimeNanosUnsafe(),
    monotonicTimeNanosUnsafe: () => current.monotonicTimeNanosUnsafe(),
    currentTimeMillis: Effect.suspend(() => current.currentTimeMillis),
    currentTimeNanos: Effect.suspend(() => current.currentTimeNanos),
    monotonicTimeNanos: Effect.suspend(() => current.monotonicTimeNanos),
    sleep: (duration) => Effect.suspend(() => current.sleep(duration)),
  }
  return {
    clock,
    freeze: async () => {
      await Effect.runPromise(test.setTime(live.currentTimeMillisUnsafe()))
      current = test
    },
    advance: (millis: number) => Effect.runPromise(test.adjust(millis)),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
