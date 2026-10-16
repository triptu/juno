import { assert, it } from '@effect/vitest'
import { Clock, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { RequestQueue, slackConfigLayer } from '../src/index.ts'

/** Starts `method` on the background lane now and says when it started, once it has. */
const startAt = (queue: RequestQueue['Service'], method: string) =>
  Effect.forkChild(queue.run('background', method, Clock.currentTimeMillis))

it.effect('runs different methods side by side, each at its own rate, within the total ceiling', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const starts: Array<[string, number]> = []
  // In order, each started only once the one before it has: the lane's spacing decides when.
  for (const method of ['conversations.history', 'conversations.replies', 'search.modules.messages', 'conversations.history', 'conversations.replies', 'search.modules.messages']) {
    const fiber = yield* startAt(queue, method)
    yield* TestClock.adjust(0)
    while (fiber.pollUnsafe() === undefined) yield* TestClock.adjust(100)
    starts.push([method, yield* Fiber.join(fiber)])
  }
  assert.deepEqual(starts, [
    // 120 a minute in total: 500 ms between any two starts.
    ['conversations.history', 0],
    ['conversations.replies', 500],
    ['search.modules.messages', 1_000],
    // 40 a minute for history and replies, 10 for search.
    ['conversations.history', 1_500],
    ['conversations.replies', 2_000],
    ['search.modules.messages', 7_000],
  ])
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('spaces a method no rate names 3 s apart', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.run('background', 'conversations.info', Effect.void)
  const next = yield* startAt(queue, 'conversations.info')
  yield* TestClock.adjust(3_000)
  assert.equal(yield* Fiber.join(next), 3_000)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('takes per-method rates from config', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* startAt(queue, 'conversations.history')
  yield* TestClock.adjust(4_000)
  assert.equal(yield* Fiber.join(next), 4_000)
}).pipe(Effect.provide(RequestQueue.layer), Effect.provide(slackConfigLayer({ lanes: { backgroundPacing: { totalMillis: 500, methodMillis: 3_000, methods: { 'conversations.history': 4_000 } } } }))))

it.effect('keeps method spacing when another method can use the background lane', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  yield* TestClock.adjust(1_500)
  yield* queue.run('background', 'client.counts', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
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
  const next = yield* Effect.forkChild(Effect.forEach(Array.from({ length: 21 }), () => queue.run('interactive', 'conversations.history', Effect.sync(() => { refill.push(1) })), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  assert.equal(refill.length, 20)
  yield* TestClock.adjust(500)
  yield* Fiber.join(next)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('doubles a method only once during a shared Retry-After window', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  for (let i = 0; i < 5; i++) yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  assert.equal(yield* Fiber.join(next), 4_000)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('halves backoff every five quiet minutes down to the base', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(300_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  assert.equal(yield* Fiber.join(next), 304_000)
  yield* TestClock.adjust(600_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const base = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(1_500)
  assert.equal(yield* Fiber.join(base), 905_500)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('rechecks a long method pause after waiting for an interactive permit', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const busy = yield* Effect.forkChild(Effect.forEach([1, 2, 3], () => queue.run('interactive', 'client.counts', Effect.sleep(1_000)), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  const waiting = yield* Effect.forkChild(queue.run('interactive', 'conversations.history', Effect.void).pipe(Effect.flip))
  yield* TestClock.adjust(0)
  yield* queue.pause('conversations.history', 30_000)
  yield* TestClock.adjust(1_000)
  assert.equal((yield* Fiber.join(waiting)).retryAfterMillis, 29_000)
  yield* Fiber.join(busy)
}).pipe(Effect.provide(RequestQueue.layer)))

it.effect('a later 429 resets the five-minute quiet period', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(299_000)
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(6_000)
  assert.equal(yield* Fiber.join(next), 306_000)
}).pipe(Effect.provide(RequestQueue.layer)))
