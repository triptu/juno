/**
 * The interactive lane's permits, shared by `interactive` and `paging`
 * calls (`queue.ts`). A waiting interactive call is let in before any
 * paging call, in arrival order. A paging call starts only while no
 * interactive call waits and a permit stays free after it, so the user's
 * own call never queues behind pages read ahead of them. With one permit
 * paging only yields.
 */
import { Deferred, Effect } from 'effect'

export const makeSharedPermits = (total: number) => {
  const kept = total > 1 ? 1 : 0
  let free = total
  const waiting: Array<{ readonly paging: boolean; readonly granted: Deferred.Deferred<void> }> = []

  const admit = () => {
    while (free > 0 && waiting.length > 0) {
      const user = waiting.findIndex((entry) => !entry.paging)
      const next = user >= 0 ? user : free > kept ? 0 : -1
      if (next < 0) return
      const [entry] = waiting.splice(next, 1)
      free -= 1
      Deferred.doneUnsafe(entry!.granted, Effect.void)
    }
  }

  const acquire = (paging: boolean) =>
    Effect.suspend(() => {
      const entry = { paging, granted: Deferred.makeUnsafe<void>() }
      waiting.push(entry)
      admit()
      return Deferred.await(entry.granted).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            const index = waiting.indexOf(entry)
            if (index >= 0) return void waiting.splice(index, 1)
            // Granted as the wait was interrupted: hand it on.
            free += 1
            admit()
          }),
        ),
      )
    })

  const release = Effect.sync(() => {
    free += 1
    admit()
  })

  return {
    withPermit:
      (paging: boolean) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.uninterruptibleMask((restore) => Effect.flatMap(restore(acquire(paging)), () => restore(effect).pipe(Effect.ensuring(release)))),
  }
}
