/**
 * Who of the people `presence/service.ts` follows has notifications paused
 * (SPEC 14, "Paused colleagues"), from Slack's Do Not Disturb, in memory
 * only. People are asked about with `dnd.teamInfo`, in batches: those
 * waiting while a call runs go in the next one. A batch that fails does not
 * stop the others; its people are asked again after `dndRetryBaseMillis`,
 * doubling, at most `RETRIES` times, and then at the next change or
 * connect. One timer wakes at the earliest time anyone's pause starts or
 * ends, publishes, and asks again about each person whose scheduled pause
 * just ended, since Slack names only the next one. The timer is
 * `sleepUntil`, so a Mac that slept past an end shows it at the wake.
 * `refresh` asks again about people whose answer is older than
 * `dndStaleMillis`, for a DM that is shown. Nothing polls.
 */
import { dndNextChange, dndPaused, type SlackDnd } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { Clock, Effect, Fiber, Queue, Result, type Scope, type Semaphore } from 'effect'
import { EngineTiming } from '../config'
import { sleepUntil, SystemWake } from '../systemWake'

/** People asked about in one `dnd.teamInfo`, at most. */
const BATCH = 100

/** Times a failed lookup is tried again before it waits for the next change or connect. */
const RETRIES = 4

interface Options {
  readonly selfId: string
  /** The people followed now. */
  readonly wanted: () => ReadonlySet<string>
  /** The presence service's lock: answers and the timer change state under it. */
  readonly lock: Semaphore.Semaphore
  /** Sends what is known now; called under the lock. */
  readonly publish: Effect.Effect<void>
}

/** What is known about the followed people's Do Not Disturb, in memory. */
interface Known {
  /** What Slack last said about each followed person, other than the user. */
  readonly dnd: Map<string, SlackDnd>
  /** When Slack last answered about each person in `dnd`, in epoch milliseconds. */
  readonly answeredAt: Map<string, number>
  /** Failed lookups in a row for each person. */
  readonly failures: Map<string, number>
  /** Moves on each `forget`, so a retry queued for an earlier connection is dropped. */
  generation: number
}

interface Shared extends Options {
  readonly known: Known
  readonly asks: Queue.Queue<string>
  readonly scope: Scope.Scope
}

export const pausedPeople = (options: Options): Effect.Effect<{
  /** The followed people paused at `nowSeconds`, sorted. */
  readonly now: (nowSeconds: number) => ReadonlyArray<string>
  /** Queues `ids` to be asked about. */
  readonly askAbout: (ids: Iterable<string>) => Effect.Effect<void>
  /** Queues those of `ids` whose last answer is older than `dndStaleMillis`. */
  readonly refresh: (ids: Iterable<string>) => Effect.Effect<void>
  /** Forgets everyone, when Juno can no longer know. */
  readonly forget: () => void
  /** Forgets those no longer followed; the followed ones not yet asked about. */
  readonly keepOnly: (followed: ReadonlySet<string>) => ReadonlyArray<string>
}, never, SlackApi | SystemWake | Scope.Scope> => Effect.gen(function* () {
  const { selfId, wanted } = options
  const timing = yield* EngineTiming
  const known: Known = { dnd: new Map(), answeredAt: new Map(), failures: new Map(), generation: 0 }
  const shared: Shared = { ...options, known, asks: yield* Queue.unbounded<string>(), scope: yield* Effect.scope }
  const askAbout = (ids: Iterable<string>) => Effect.forEach([...ids].filter((id) => id !== selfId), (id) => Queue.offer(shared.asks, id), { discard: true })
  const ask = yield* lookups(shared, yield* timer(shared), askAbout)

  yield* Effect.forkScoped(Effect.forever(Effect.gen(function* () {
    const ids = new Set(yield* Queue.takeAll(shared.asks))
    const followed = wanted()
    yield* ask([...ids].filter((id) => followed.has(id)).toSorted())
  })))

  return {
    now: (nowSeconds) => [...known.dnd].filter(([id, value]) => wanted().has(id) && dndPaused(value, nowSeconds)).map(([id]) => id).toSorted(),
    askAbout,
    refresh: (ids) => Effect.flatMap(Clock.currentTimeMillis, (now) =>
      askAbout([...ids].filter((id) => {
        const at = known.answeredAt.get(id)
        return at !== undefined && now - at > timing.dndStaleMillis
      }))),
    forget: () => {
      known.dnd.clear()
      known.answeredAt.clear()
      known.failures.clear()
      known.generation += 1
    },
    keepOnly: (followed) => {
      for (const map of [known.dnd, known.answeredAt, known.failures]) for (const id of map.keys()) if (!followed.has(id)) map.delete(id)
      return [...followed].filter((id) => id !== selfId && !known.dnd.has(id))
    },
  }
})

/** The one timer: waits for the earliest start or end of anyone's pause, then publishes and asks again about each scheduled pause that ended. */
const timer = ({ known, asks, scope, lock, publish }: Shared) => Effect.gen(function* () {
  const wake = yield* SystemWake
  let fiber: Fiber.Fiber<void> | undefined
  const schedule: Effect.Effect<void> = Effect.gen(function* () {
    if (fiber !== undefined) yield* Fiber.interrupt(fiber)
    fiber = undefined
    const from = (yield* Clock.currentTimeMillis) / 1000
    const next = Math.min(...[...known.dnd.values()].flatMap((value) => dndNextChange(value, from) ?? []))
    if (!Number.isFinite(next)) return
    fiber = yield* Effect.forkIn(Effect.gen(function* () {
      yield* Effect.provideService(sleepUntil(next * 1000), SystemWake, wake)
      yield* lock.withPermits(1)(Effect.gen(function* () {
        fiber = undefined
        const at = (yield* Clock.currentTimeMillis) / 1000
        for (const [id, value] of known.dnd) if (value.nextEnd !== 1 && value.nextEnd > from && value.nextEnd <= at) yield* Queue.offer(asks, id)
        yield* publish
        yield* schedule
      }))
    }), scope)
  })
  return schedule
})

/** `dnd.teamInfo` in batches, each on its own: a failed one is logged and tried again later, and the others go on. */
const lookups = ({ known, scope, lock, publish, wanted, selfId }: Shared, schedule: Effect.Effect<void>, askAbout: (ids: Iterable<string>) => Effect.Effect<void>) => Effect.gen(function* () {
  const api = yield* SlackApi
  const timing = yield* EngineTiming

  /** Asks again about `ids` after a failed lookup, later each time, until `RETRIES` failures in a row. */
  const retry = (ids: ReadonlyArray<string>) => Effect.gen(function* () {
    const byDelay = new Map<number, Array<string>>()
    for (const id of ids) {
      const count = (known.failures.get(id) ?? 0) + 1
      known.failures.set(id, count)
      if (count > RETRIES) continue
      const delay = timing.dndRetryBaseMillis * 2 ** (count - 1)
      byDelay.set(delay, [...(byDelay.get(delay) ?? []), id])
    }
    const asked = known.generation
    for (const [delay, group] of byDelay) {
      yield* Effect.forkIn(Effect.sleep(delay).pipe(Effect.andThen(Effect.suspend(() => (asked === known.generation ? askAbout(group) : Effect.void)))), scope)
    }
  })

  return (ids: ReadonlyArray<string>) => Effect.gen(function* () {
    const failed: Array<string> = []
    for (let start = 0; start < ids.length; start += BATCH) {
      const batch = ids.slice(start, start + BATCH)
      const answer = yield* Effect.result(api.call('dnd.teamInfo', { users: batch.join(',') }, { lane: 'background' }))
      if (Result.isFailure(answer)) {
        yield* Effect.logWarning('presence: could not read who has notifications paused', { error: String(answer.failure) })
        failed.push(...batch)
        continue
      }
      yield* lock.withPermits(1)(Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const followed = wanted()
        for (const id of batch) known.failures.delete(id)
        for (const [id, value] of Object.entries(answer.success.users)) {
          if (!followed.has(id) || id === selfId) continue
          known.answeredAt.set(id, now)
          known.dnd.set(id, {
            nextStart: value.next_dnd_start_ts,
            nextEnd: value.next_dnd_end_ts,
            ...(value.snooze_enabled === true && value.snooze_endtime !== undefined ? { snoozeEnd: value.snooze_endtime } : {}),
          })
        }
        yield* publish
        yield* schedule
      }))
    }
    if (failed.length > 0) yield* lock.withPermits(1)(retry(failed))
  })
})
