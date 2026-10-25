import { Clock, Duration, Effect } from 'effect'

/**
 * The engine's clock for a DOM lane test with a test clock
 * (`apps/desktop/dom/clock.ts`): live time plus an offset, so it flows as
 * the page's installed clock does, and `jump` moves it forward and wakes
 * every sleep that fell due, as the page's `fastForward` fires its timers.
 * Code that reads `Date.now()` outside Effect keeps real time.
 */
export function jumpClock(): { readonly clock: Clock.Clock; readonly jump: (millis: number) => Promise<void> } {
  const live = Effect.runSync(Clock.Clock)
  let offset = 0
  const sleepers = new Set<{ readonly at: number; readonly wake: () => void }>()
  const nanos = () => BigInt(offset) * 1_000_000n
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => live.currentTimeMillisUnsafe() + offset,
    currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe() + nanos(),
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe() + nanos(),
    currentTimeMillis: Effect.sync(() => live.currentTimeMillisUnsafe() + offset),
    currentTimeNanos: Effect.sync(() => live.currentTimeNanosUnsafe() + nanos()),
    monotonicTimeNanos: Effect.sync(() => live.monotonicTimeNanosUnsafe() + nanos()),
    sleep: (duration) => Effect.callback<void>((resume) => {
      const millis = Duration.toMillis(duration)
      const entry = {
        at: live.currentTimeMillisUnsafe() + offset + millis,
        wake: () => {
          clearTimeout(timer)
          sleepers.delete(entry)
          resume(Effect.void)
        },
      }
      const timer = setTimeout(entry.wake, millis)
      sleepers.add(entry)
      return Effect.sync(() => {
        clearTimeout(timer)
        sleepers.delete(entry)
      })
    }),
  }
  return {
    clock,
    jump: async (millis) => {
      offset += millis
      const now = live.currentTimeMillisUnsafe() + offset
      for (const sleeper of [...sleepers].filter((each) => each.at <= now).toSorted((a, b) => a.at - b.at)) sleeper.wake()
      // Let the woken fibers run before the page's timers fire.
      await new Promise((done) => setImmediate(done))
    },
  }
}
