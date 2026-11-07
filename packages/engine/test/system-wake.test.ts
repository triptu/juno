// `sleepUntil` (src/systemWake.ts): a pause's end timer against the wall clock. A timer counts time the process
// runs, so it can fire before the wall clock reaches the end (the clock was set back), or not at all while the Mac
// sleeps past the end. The clock here is the wall clock alone: its timers fire only when the test says.
import { expect } from 'bun:test'
import { itLive } from '@juno/testing/effect'
import { eventually } from '@juno/testing/eventually'
import { Clock, Effect, Fiber, Layer } from 'effect'
import { HostLink, memoryHost } from '../src/protocol/host'
import { sleepUntil, SystemWake } from '../src/systemWake'

itLive('a wait for a wall-clock time waits again when its timer fires early, and ends at the wake after the Mac slept past it', () => Effect.gen(function* () {
  let now = 0
  const timers = new Set<() => void>()
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    sleep: () => Effect.callback<void>((resume) => {
      const fire = () => {
        timers.delete(fire)
        resume(Effect.void)
      }
      timers.add(fire)
      return Effect.sync(() => timers.delete(fire))
    }),
  }
  const fireTimers = () => {
    // Copied first: a fired wait that sets a new timer must not be fired by the same call.
    for (const fire of Array.from(timers)) fire()
  }
  const until = (check: () => void) => Effect.promise(() => eventually(check, { timeout: 2_000 }))

  const host = memoryHost()
  const wake = yield* Layer.build(SystemWake.layer.pipe(Layer.provide(HostLink.layer(host))))
  let ended = false
  const waiting = yield* Effect.forkChild(sleepUntil(1_000).pipe(
    Effect.andThen(Effect.sync(() => { ended = true })),
    Effect.provideContext(wake),
    Effect.provideService(Clock.Clock, clock),
  ))
  yield* until(() => expect(timers.size).toBe(1))

  // The timer fires while the wall clock is still before the end: it reads the clock and sets a new timer.
  now = 400
  const [first] = timers
  fireTimers()
  yield* until(() => expect(timers.size === 1 && !timers.has(first!)).toBe(true))
  expect(ended).toBe(false)

  // The Mac sleeps past the end; its timer does not fire. The wake ends the wait.
  now = 5_000
  host.deliver({ _tag: 'wake' })
  yield* until(() => expect(ended).toBe(true))
  yield* Fiber.join(waiting)
}))
