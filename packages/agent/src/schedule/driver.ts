import type { Scheduler } from './scheduler'

/** One refresh at a time; shutdown waits for an in-flight host read before closing SQLite. */
export function driveScheduler(scheduler: Scheduler, report: (error: unknown) => void) {
  let closed = false
  let pending: Promise<void> | undefined
  let again = false
  const tick = (): Promise<void> => {
    if (closed) return Promise.resolve()
    if (pending !== undefined) { again = true; return pending }
    pending = (async () => {
      do {
        again = false
        await scheduler.tick()
        // oxlint-disable-next-line no-unmodified-loop-condition -- `close()` can change `closed` during the awaited tick.
      } while (again && !closed)
    })().catch(report).finally(() => { pending = undefined })
    return pending
  }
  const timer = setInterval(() => { void tick() }, 1000)
  timer.unref()
  return { tick, close: async () => { closed = true; clearInterval(timer); await pending } }
}
