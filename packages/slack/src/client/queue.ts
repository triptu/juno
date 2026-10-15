/**
 * The three lanes of docs/architecture.md section 5.1 and the per-method
 * rate buckets.
 *
 * - `interactive`: what the user is waiting for. Concurrency 3. Never waits
 *   long: if the method is paused for longer than `interactiveMaxWaitMillis`
 *   the call fails at once with `SlackRateLimited`, so the route can answer
 *   from the cache and the engine can show `rate-limited`.
 * - `background`: backfill and sweeps. Concurrency 2, starts spaced by
 *   `backgroundMinIntervalMillis` (40 per minute by default).
 * - `send`: one in flight, like the official client's message queue.
 *
 * The lanes have separate permits, so a flood of background calls cannot
 * starve an interactive one. A 429 pauses one method's bucket until its
 * `Retry-After`; every other method keeps going.
 *
 * `slowedUntil` tells the engine when Slack has slowed it down: the end of
 * the latest pause longer than `interactiveMaxWaitMillis`, the wait the
 * interactive lane gives up at, and `undefined` once every such pause has
 * ended. Shorter pauses pass unnoticed.
 */
import { Clock, Context, Effect, Layer, Ref, Semaphore, Stream, SubscriptionRef } from 'effect'
import { SlackConfig } from './config.ts'
import { SlackRateLimited } from './errors.ts'

export type Lane = 'interactive' | 'background' | 'send'

export interface RequestQueueShape {
  /** Runs `effect` on `lane` once `method` is not paused and a permit is free. */
  run<A, E, R>(lane: Lane, method: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | SlackRateLimited, R>
  /** Pauses `method` for `retryAfterMillis`, capped by `maxRetryAfterMillis`. */
  pause(method: string, retryAfterMillis: number): Effect.Effect<void>
  /** Epoch millis until which `method` is paused, if it is. */
  pausedUntil(method: string): Effect.Effect<number | undefined>
  /** Epoch millis until which a long pause holds the client back, at subscribe time and on every change; `undefined` when none does. */
  readonly slowedUntil: Stream.Stream<number | undefined>
}

export class RequestQueue extends Context.Service<RequestQueue, RequestQueueShape>()('juno/slack/RequestQueue') {
  static readonly layer: Layer.Layer<RequestQueue> = Layer.effect(
    RequestQueue,
    Effect.gen(function* () {
      const config = yield* SlackConfig
      const permits = {
        interactive: yield* Semaphore.make(config.lanes.interactiveConcurrency),
        background: yield* Semaphore.make(config.lanes.backgroundConcurrency),
        send: yield* Semaphore.make(config.lanes.sendConcurrency),
      }
      const paused = yield* Ref.make(new Map<string, number>())
      const nextBackgroundStart = yield* Ref.make(0)
      const slotLock = yield* Semaphore.make(1)
      const slowed = yield* SubscriptionRef.make<number | undefined>(undefined)
      const scope = yield* Effect.scope

      /** Clears `slowed` at `until` unless a later pause has moved it. */
      const clearAt = (until: number) =>
        Effect.gen(function* () {
          yield* Effect.sleep(Math.max(0, until - (yield* Clock.currentTimeMillis)))
          yield* SubscriptionRef.update(slowed, (current) => (current === until ? undefined : current))
        })

      const pausedUntil = (method: string) =>
        Effect.gen(function* () {
          const until = (yield* Ref.get(paused)).get(method)
          if (until === undefined) return undefined
          const now = yield* Clock.currentTimeMillis
          return until > now ? until : undefined
        })

      const pause = (method: string, retryAfterMillis: number) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const wait = Math.min(Math.max(retryAfterMillis, 0), config.maxRetryAfterMillis)
          const until = now + wait
          yield* Ref.update(paused, (map) => new Map(map).set(method, Math.max(until, map.get(method) ?? 0)))
          if (wait <= config.interactiveMaxWaitMillis) return
          const moved = yield* SubscriptionRef.modify(slowed, (current) => (current !== undefined && current >= until ? [false, current] : [true, until]))
          if (moved) yield* Effect.forkIn(clearAt(until), scope)
        })

      /** Waits until the method's bucket is open. The interactive lane gives up instead of waiting long. */
      const waitForMethod = (lane: Lane, method: string): Effect.Effect<void, SlackRateLimited> =>
        Effect.gen(function* () {
          while (true) {
            const until = yield* pausedUntil(method)
            if (until === undefined) return
            const remaining = until - (yield* Clock.currentTimeMillis)
            if (lane === 'interactive' && remaining > config.interactiveMaxWaitMillis) {
              return yield* new SlackRateLimited({ method, retryAfterMillis: remaining })
            }
            yield* Effect.sleep(remaining)
          }
        })

      /** Reserves the next background start time and waits for it. */
      const spaceBackground = Effect.gen(function* () {
        const wait = yield* slotLock.withPermit(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const next = yield* Ref.get(nextBackgroundStart)
            const start = Math.max(now, next)
            yield* Ref.set(nextBackgroundStart, start + config.lanes.backgroundMinIntervalMillis)
            return start - now
          }),
        )
        if (wait > 0) yield* Effect.sleep(wait)
      })

      const run = <A, E, R>(lane: Lane, method: string, effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          yield* waitForMethod(lane, method)
          return yield* permits[lane].withPermit(
            lane === 'background' ? Effect.andThen(spaceBackground, effect) : effect,
          )
        })

      return RequestQueue.of({ run, pause, pausedUntil, slowedUntil: SubscriptionRef.changes(slowed) })
    }),
  )
}
