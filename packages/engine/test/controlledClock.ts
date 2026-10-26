import { Clock, Duration, Effect, Exit, Scope } from 'effect'
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
    now: () => current.currentTimeMillisUnsafe(),
    advance: (millis: number) => Effect.runPromise(test.adjust(millis)),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/** Live time and sleeps, moved so the clock reads `at` now. For tests of local hours, which must not depend on when they run. */
export function clockAt(at: number): Clock.Clock {
  const live = Effect.runSync(Clock.Clock)
  const offset = at - live.currentTimeMillisUnsafe()
  const nanos = BigInt(offset) * 1_000_000n
  return {
    currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe() + offset,
    currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe() + nanos,
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    currentTimeMillis: Effect.sync(() => live.currentTimeMillisUnsafe() + offset),
    currentTimeNanos: Effect.sync(() => live.currentTimeNanosUnsafe() + nanos),
    monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: (duration) => live.sleep(duration),
  }
}

/** Today's noon in the local zone, within about 12 hours of now, so a moved clock keeps stored data about as old as it is. */
export function localNoon(): number {
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  return noon.getTime()
}

/** Controls one scheduling window while unrelated I/O and debounce timers keep live time. */
export async function controlledSleep(millis: number) {
  const time = await controlledClock()
  const live = Effect.runSync(Clock.Clock)
  await time.freeze()
  const armed = { count: 0 }
  const controlled = (duration: Duration.Duration) => Effect.suspend(() => {
    armed.count++
    return time.clock.sleep(duration).pipe(Effect.ensuring(Effect.sync(() => { armed.count-- })))
  })
  const whenArmed = async (timeoutMillis = 20_000) => {
    const started = Date.now()
    while (armed.count === 0) {
      if (Date.now() - started > timeoutMillis) throw new Error(`timed out waiting for a ${millis} ms sleep`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return {
    ...time,
    /** Waits until a sleep of this duration is armed. */
    armed: () => whenArmed(),
    /** Waits until a sleep of this duration is armed, then ends it by advancing exactly that long. */
    fire: async (timeoutMillis = 20_000) => {
      await whenArmed(timeoutMillis)
      await time.advance(millis)
    },
    clock: {
      currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe(),
      currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe(),
      monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
      currentTimeMillis: live.currentTimeMillis,
      currentTimeNanos: live.currentTimeNanos,
      monotonicTimeNanos: live.monotonicTimeNanos,
      sleep: (duration: Duration.Duration) => Duration.toMillis(duration) === millis ? controlled(duration) : live.sleep(duration),
    } satisfies Clock.Clock,
  }
}

/** An interval no other engine sleep uses, so only the periodic sweep waits on it. */
const SWEEP_MILLIS = 4_567

/**
 * The periodic sweep on test-driven time: pass `clock` and `sweepIntervalMillis` to the engine, then
 * `sweep(engine)` starts exactly one sweep and waits for its cycle to finish. Close after the engine stops.
 */
export async function controlledSweeps() {
  const time = await controlledSleep(SWEEP_MILLIS)
  return {
    clock: time.clock,
    sweepIntervalMillis: SWEEP_MILLIS,
    close: time.close,
    start: time.fire,
    sweep: async (engine: { readonly nextSync: () => Promise<void> }) => {
      const finished = engine.nextSync()
      await time.fire()
      await finished
    },
  }
}
