import { assert, it } from '@effect/vitest'
import { Clock, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { RequestQueue } from '../src/index.ts'

it.effect('spaces background starts across different methods at 40 per minute', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const starts: number[] = []
  const calls = yield* Effect.forkChild(Effect.forEach(['history', 'replies', 'counts'], (method) =>
    queue.run('background', method, Clock.currentTimeMillis.pipe(Effect.tap((now) => Effect.sync(() => { starts.push(now) })))), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(3_000)
  yield* Fiber.join(calls)
  assert.deepEqual(starts, [0, 1_500, 3_000])
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('keeps method spacing when another method can use the background lane', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'history', Effect.void)
  yield* TestClock.adjust(1_500)
  yield* queue.run('background', 'counts', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'history', Clock.currentTimeMillis))
  yield* TestClock.adjust(4_500)
  assert.equal(yield* Fiber.join(next), 8_000)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('queues interactive bursts after 20 starts and refills two tokens per second', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const starts: number[] = []
  const burst = yield* Effect.forkChild(Effect.forEach(Array.from({ length: 30 }, (_, i) => String(i)), (method) =>
    queue.run('interactive', method, Clock.currentTimeMillis.pipe(Effect.tap((now) => Effect.sync(() => { starts.push(now) })))), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  assert.equal(starts.length, 20)
  yield* queue.run('send', 'post', Effect.void)
  yield* TestClock.adjust(5_000)
  yield* Fiber.join(burst)
  assert.deepEqual(starts.slice(20), Array.from({ length: 10 }, (_, i) => (i + 1) * 500))
  yield* TestClock.adjust(60_000)
  const refill: number[] = []
  const next = yield* Effect.forkChild(Effect.forEach(Array.from({ length: 21 }), () => queue.run('interactive', 'history', Effect.sync(() => { refill.push(1) })), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  assert.equal(refill.length, 20)
  yield* TestClock.adjust(500)
  yield* Fiber.join(next)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('doubles a method only once during a shared Retry-After window', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  for (let i = 0; i < 5; i++) yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  assert.equal(yield* Fiber.join(next), 4_000)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('halves backoff every five quiet minutes down to the base', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(300_000)
  yield* queue.run('background', 'history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  assert.equal(yield* Fiber.join(next), 304_000)
  yield* TestClock.adjust(600_000)
  yield* queue.run('background', 'history', Effect.void)
  const base = yield* Effect.forkChild(queue.run('background', 'history', Clock.currentTimeMillis))
  yield* TestClock.adjust(1_500)
  assert.equal(yield* Fiber.join(base), 905_500)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('rechecks a long method pause after waiting for an interactive permit', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const busy = yield* Effect.forkChild(Effect.forEach([1, 2, 3], () => queue.run('interactive', 'counts', Effect.sleep(1_000)), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  const waiting = yield* Effect.forkChild(queue.run('interactive', 'history', Effect.void).pipe(Effect.flip))
  yield* TestClock.adjust(0)
  yield* queue.pause('history', 30_000)
  yield* TestClock.adjust(1_000)
  assert.equal((yield* Fiber.join(waiting)).retryAfterMillis, 29_000)
  yield* Fiber.join(busy)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('a later 429 resets the five-minute quiet period', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(299_000)
  yield* queue.pause('history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'history', Clock.currentTimeMillis))
  yield* TestClock.adjust(6_000)
  assert.equal(yield* Fiber.join(next), 306_000)
}).pipe(Effect.provide(RequestQueue.layer)))
