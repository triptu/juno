/**
 * The three lanes of docs/architecture.md section 5.1 and the per-method
 * rate buckets.
 *
 * - `interactive`: what the user is waiting for. Concurrency 3. Never waits
 *   long: if the method is paused for longer than `interactiveMaxWaitMillis`
 *   the call fails at once with `SlackRateLimited`, so the route can answer
 *   from the cache and the engine can show `rate-limited`.
 * - `background`: backfill and sweeps. Concurrency 2, each method spaced 1,500 ms apart on its own (research section 6).
 *   A 429 doubles that method's interval for the session, up to 60 s.
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
      const buckets = new Map<string, { next: number; interval: number }>()
      const bucketOf = (method: string) => {
        let bucket = buckets.get(method)
        if (bucket === undefined) {
          // 40 per minute per method: the rate measured safe live. The token is shared with the
          // official client, so Juno stays below the published 50 per minute to leave it room.
          bucket = { next: 0, interval: config.lanes.backgroundMinIntervalMillis ?? 1_500 }
          buckets.set(method, bucket)
        }
        return bucket
      }
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
          const bucket = bucketOf(method)
          bucket.interval = Math.min(60_000, bucket.interval * 2)
          const now = yield* Clock.currentTimeMillis
          const wait = Math.min(Math.max(retryAfterMillis, 0), config.maxRetryAfterMillis)
          const until = now + wait
          yield* Ref.update(paused, (map) => new Map(map).set(method, Math.max(until, map.get(method) ?? 0)))
          if (wait <= config.interactiveMaxWaitMillis) return
          const moved = yield* SubscriptionRef.modify(slowed, (current) => (current !== undefined && current >= until ? [false, current] : [true, until]))
          if (moved) yield* Effect.forkIn(clearAt(until), scope)
        })

      const run = <A, E, R>(lane: Lane, method: string, effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          while (true) {
            if (lane === 'interactive') {
              const remaining = ((yield* pausedUntil(method)) ?? 0) - (yield* Clock.currentTimeMillis)
              if (remaining > config.interactiveMaxWaitMillis) return yield* new SlackRateLimited({ method, retryAfterMillis: remaining })
            }
            const result = yield* permits[lane].withPermit(Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              const pauseEnd = (yield* Ref.get(paused)).get(method) ?? 0
              const bucket = lane === 'background' ? bucketOf(method) : undefined
              const until = Math.max(pauseEnd, bucket?.next ?? 0)
              // Do not reserve a future slot or hold a lane permit while sleeping.
              // Another method can run, and a new pause is checked on every admission.
              if (until > now) return { kind: 'wait', millis: until - now } as const
              if (bucket !== undefined) bucket.next = now + bucket.interval
              const value = yield* effect
              return { kind: 'done', value } as const
            }))
            if (result.kind === 'done') return result.value
            if (lane === 'interactive' && result.millis > config.interactiveMaxWaitMillis) {
              return yield* new SlackRateLimited({ method, retryAfterMillis: result.millis })
            }
            yield* Effect.sleep(result.millis)
          }
        })

      return RequestQueue.of({ run, pause, pausedUntil, slowedUntil: SubscriptionRef.changes(slowed) })
    }),
  )
}
