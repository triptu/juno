import { expect, it } from 'bun:test'
import { Clock, Duration, Effect, Fiber, PubSub, Stream } from 'effect'
import { reach } from '../src/profileStatus/expiry'

/** A wall clock the test sets, and sleeps that end only when the test says: a timer that runs early, or a Mac asleep. */
function handClock() {
  let wall = 0
  const sleeps: Array<{ readonly millis: number; readonly end: () => void }> = []
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => wall,
    currentTimeNanosUnsafe: () => BigInt(wall) * 1_000_000n,
    monotonicTimeNanosUnsafe: () => BigInt(wall) * 1_000_000n,
    currentTimeMillis: Effect.sync(() => wall),
    currentTimeNanos: Effect.sync(() => BigInt(wall) * 1_000_000n),
    monotonicTimeNanos: Effect.sync(() => BigInt(wall) * 1_000_000n),
    sleep: (duration) => Effect.callback<void>((resume) => {
      sleeps.push({ millis: Duration.toMillis(duration), end: () => resume(Effect.void) })
    }),
  }
  return { clock, sleeps, set: (at: number) => { wall = at } }
}

// Fixed wait: one macrotask lets the forked fiber run to its next sleep, which the test then reads.
const settle = () => new Promise((done) => setTimeout(done, 0))

it('a sleep that ends before the deadline waits again for what is left, and a wake past it ends the wait', async () => {
  const time = handClock()
  const wakes = Effect.runSync(PubSub.unbounded<void>())
  const fiber = Effect.runFork(reach(1_000, Stream.fromPubSub(wakes)).pipe(Effect.provideService(Clock.Clock, time.clock)))
  await settle()
  expect(time.sleeps.map((sleep) => sleep.millis)).toEqual([1_000])

  // The timer ran early against the wall clock.
  time.set(600)
  time.sleeps[0]!.end()
  await settle()
  expect(time.sleeps.map((sleep) => sleep.millis)).toEqual([1_000, 400])
  expect(fiber.pollUnsafe()).toBeUndefined()

  // The Mac slept past the deadline: the pending sleep has not ended, the wake ends the wait.
  time.set(5_000)
  Effect.runSync(PubSub.publish(wakes, undefined))
  await Effect.runPromise(Fiber.join(fiber))
  expect(time.sleeps).toHaveLength(2)
})
