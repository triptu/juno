import { Effect } from 'effect'

/** Warn once per minute when a worker runs over twice a second for a whole minute. */
export function watchWorkerPasses(worker: 'post' | 'action' | 'mark') {
  let since: number | undefined
  let passes = 0
  return (now: number) => Effect.suspend(() => {
    since ??= now
    passes++
    if (now - since < 60_000) return Effect.void
    const frequent = passes > 120
    const count = passes
    since = now; passes = 0
    return frequent ? Effect.logWarning('worker passes unusually frequent', { worker, passes: count }) : Effect.void
  })
}
