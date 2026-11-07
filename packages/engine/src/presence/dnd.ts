/**
 * Who of the people `presence/service.ts` follows has notifications paused
 * (SPEC 14, "Paused colleagues"), from Slack's Do Not Disturb, in memory
 * only. People are asked about with `dnd.teamInfo`, in batches: those
 * waiting while a call runs go in the next one. One timer wakes at the
 * earliest time anyone's pause starts or ends, publishes, and asks again
 * about each person whose scheduled pause just ended, since Slack names
 * only the next one. Nothing polls.
 */
import { dndNextChange, dndPaused, type SlackDnd } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { Clock, Effect, Fiber, Queue, type Scope, type Semaphore } from 'effect'

/** People asked about in one `dnd.teamInfo`, at most. */
const BATCH = 100

interface Options {
  readonly selfId: string
  /** The people followed now. */
  readonly wanted: () => ReadonlySet<string>
  /** The presence service's lock: answers and the timer change state under it. */
  readonly lock: Semaphore.Semaphore
  /** Sends what is known now; called under the lock. */
  readonly publish: Effect.Effect<void>
}

export const pausedPeople = ({ selfId, wanted, lock, publish }: Options): Effect.Effect<{
  /** The followed people paused at `nowSeconds`, sorted. */
  readonly now: (nowSeconds: number) => ReadonlyArray<string>
  /** Queues `ids` to be asked about. */
  readonly askAbout: (ids: Iterable<string>) => Effect.Effect<void>
  /** Forgets everyone, when Juno can no longer know. */
  readonly forget: () => void
  /** Forgets those no longer followed; the followed ones not yet asked about. */
  readonly keepOnly: (followed: ReadonlySet<string>) => ReadonlyArray<string>
}, never, SlackApi | Scope.Scope> => Effect.gen(function* () {
  const api = yield* SlackApi
  const scope = yield* Effect.scope
  /** What Slack last said about each followed person, other than the user. */
  const dnd = new Map<string, SlackDnd>()
  const asks = yield* Queue.unbounded<string>()
  let timer: Fiber.Fiber<void> | undefined

  /** Waits for the earliest start or end of anyone's pause, then publishes and asks again about each scheduled pause that ended. */
  const schedule: Effect.Effect<void> = Effect.gen(function* () {
    if (timer !== undefined) yield* Fiber.interrupt(timer)
    timer = undefined
    const from = (yield* Clock.currentTimeMillis) / 1000
    const next = Math.min(...[...dnd.values()].flatMap((value) => dndNextChange(value, from) ?? []))
    if (!Number.isFinite(next)) return
    timer = yield* Effect.forkIn(Effect.gen(function* () {
      yield* Effect.sleep(Math.max(0, next - from) * 1000)
      yield* lock.withPermits(1)(Effect.gen(function* () {
        timer = undefined
        const at = (yield* Clock.currentTimeMillis) / 1000
        for (const [id, value] of dnd) if (value.nextEnd !== 1 && value.nextEnd > from && value.nextEnd <= at) yield* Queue.offer(asks, id)
        yield* publish
        yield* schedule
      }))
    }), scope)
  })

  /** A failed call is logged; the next change or connect asks again. */
  const ask = (ids: ReadonlyArray<string>) => Effect.gen(function* () {
    for (let start = 0; start < ids.length; start += BATCH) {
      const answer = yield* api.call('dnd.teamInfo', { users: ids.slice(start, start + BATCH).join(',') }, { lane: 'background' })
      yield* lock.withPermits(1)(Effect.gen(function* () {
        const followed = wanted()
        for (const [id, value] of Object.entries(answer.users)) {
          if (!followed.has(id) || id === selfId) continue
          dnd.set(id, {
            nextStart: value.next_dnd_start_ts,
            nextEnd: value.next_dnd_end_ts,
            ...(value.snooze_enabled === true && value.snooze_endtime !== undefined ? { snoozeEnd: value.snooze_endtime } : {}),
          })
        }
        yield* publish
        yield* schedule
      }))
    }
  }).pipe(Effect.catch((error) => Effect.logWarning('presence: could not read who has notifications paused', { error: String(error) })))

  yield* Effect.forkScoped(Effect.forever(Effect.gen(function* () {
    const ids = new Set(yield* Queue.takeAll(asks))
    const followed = wanted()
    yield* ask([...ids].filter((id) => followed.has(id)).toSorted())
  })))

  return {
    now: (nowSeconds) => [...dnd].filter(([id, value]) => wanted().has(id) && dndPaused(value, nowSeconds)).map(([id]) => id).toSorted(),
    askAbout: (ids) => Effect.forEach([...ids].filter((id) => id !== selfId), (id) => Queue.offer(asks, id), { discard: true }),
    forget: () => dnd.clear(),
    keepOnly: (followed) => {
      for (const id of dnd.keys()) if (!followed.has(id)) dnd.delete(id)
      return [...followed].filter((id) => id !== selfId && !dnd.has(id))
    },
  }
})
