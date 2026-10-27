import { expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Clock, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { RequestQueue, slackConfigLayer } from '../src/index.ts'

/** Starts `method` on the background lane now and says when it started, once it has. */
const startAt = (queue: RequestQueue['Service'], method: string) =>
  Effect.forkChild(queue.run('background', method, Clock.currentTimeMillis))

itEffect('runs different methods side by side, each at its own rate, within the total ceiling', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const starts: Array<[string, number]> = []
  // In order, each started only once the one before it has: the lane's spacing decides when.
  for (const method of ['conversations.history', 'conversations.replies', 'search.modules.messages', 'conversations.history', 'conversations.replies', 'search.modules.messages']) {
    const fiber = yield* startAt(queue, method)
    yield* TestClock.adjust(0)
    while (fiber.pollUnsafe() === undefined) yield* TestClock.adjust(100)
    starts.push([method, yield* Fiber.join(fiber)])
  }
  expect(starts).toEqual([
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

itEffect('takes per-method rates from config', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* startAt(queue, 'conversations.history')
  yield* TestClock.adjust(4_000)
  expect(yield* Fiber.join(next)).toBe(4_000)
}).pipe(Effect.provide(RequestQueue.layer), Effect.provide(slackConfigLayer({ lanes: { backgroundPacing: { totalMillis: 500, methodMillis: 3_000, methods: { 'conversations.history': 4_000 } } } }))))

itEffect('keeps method spacing when another method can use the background lane', () => Effect.gen(function* () {
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
  expect(yield* Fiber.join(next)).toBe(8_000)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('queues interactive bursts after 20 starts and refills two tokens per second', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const starts: number[] = []
  const burst = yield* Effect.forkChild(Effect.forEach(Array.from({ length: 30 }, (_, i) => String(i)), (method) =>
    queue.run('interactive', method, Clock.currentTimeMillis.pipe(Effect.tap((now) => Effect.sync(() => { starts.push(now) })))), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  expect(starts.length).toBe(20)
  yield* queue.run('send', 'post', Effect.void)
  yield* TestClock.adjust(5_000)
  yield* Fiber.join(burst)
  expect(starts.slice(20)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 1) * 500))
  yield* TestClock.adjust(60_000)
  const refill: number[] = []
  const next = yield* Effect.forkChild(Effect.forEach(Array.from({ length: 21 }), () => queue.run('interactive', 'conversations.history', Effect.sync(() => { refill.push(1) })), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  expect(refill.length).toBe(20)
  yield* TestClock.adjust(500)
  yield* Fiber.join(next)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('doubles a method only once during a shared Retry-After window', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  for (let i = 0; i < 5; i++) yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  expect(yield* Fiber.join(next)).toBe(4_000)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('halves backoff every five quiet minutes down to the base', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(300_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(3_000)
  expect(yield* Fiber.join(next)).toBe(304_000)
  yield* TestClock.adjust(600_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const base = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(1_500)
  expect(yield* Fiber.join(base)).toBe(905_500)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('rechecks a long method pause after waiting for an interactive permit', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const busy = yield* Effect.forkChild(Effect.forEach([1, 2, 3], () => queue.run('interactive', 'client.counts', Effect.sleep(1_000)), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  const waiting = yield* Effect.forkChild(queue.run('interactive', 'conversations.history', Effect.void).pipe(Effect.flip))
  yield* TestClock.adjust(0)
  yield* queue.pause('conversations.history', 30_000)
  yield* TestClock.adjust(1_000)
  expect((yield* Fiber.join(waiting)).retryAfterMillis).toBe(29_000)
  yield* Fiber.join(busy)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('a later 429 resets the five-minute quiet period', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(299_000)
  yield* queue.pause('conversations.history', 1_000)
  yield* TestClock.adjust(1_000)
  yield* queue.run('background', 'conversations.history', Effect.void)
  const next = yield* Effect.forkChild(queue.run('background', 'conversations.history', Clock.currentTimeMillis))
  yield* TestClock.adjust(6_000)
  expect(yield* Fiber.join(next)).toBe(306_000)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('a background call already waiting for its slot rechecks a pause that arrives meanwhile, and the pause doubles the interval', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* queue.run('background', 'conversations.history', Effect.void)
  const waiting = yield* startAt(queue, 'conversations.history')
  yield* TestClock.adjust(0)
  // Its slot comes at 1.5 s; the pause holds the method until 2 s.
  yield* queue.pause('conversations.history', 2_000)
  yield* TestClock.adjust(2_000)
  expect(yield* Fiber.join(waiting)).toBe(2_000)
  const next = yield* startAt(queue, 'conversations.history')
  yield* TestClock.adjust(3_000)
  expect(yield* Fiber.join(next)).toBe(5_000)
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('paging leaves the user a permit, and a user call waiting for one goes before waiting pages', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  const order: Array<string> = []
  const call = (lane: 'interactive' | 'paging', name: string, millis: number) =>
    Effect.forkChild(queue.run(lane, 'conversations.replies', Effect.sync(() => { order.push(name) }).pipe(Effect.andThen(Effect.sleep(millis)))))
  yield* call('paging', 'page 1', 1_000)
  yield* call('paging', 'page 2', 1_000)
  const third = yield* call('paging', 'page 3', 0)
  yield* TestClock.adjust(0)
  // The third page would take the last permit, which stays the user's.
  expect(order).toEqual(['page 1', 'page 2'])
  yield* call('interactive', 'jump', 1_000)
  yield* TestClock.adjust(0)
  expect(order).toEqual(['page 1', 'page 2', 'jump'])
  // Every permit taken: a user call waits, and the page waiting longer does not go first. A page that gives up waiting takes nothing.
  const open = yield* call('interactive', 'open', 0)
  const gone = yield* call('paging', 'gone', 0)
  yield* TestClock.adjust(0)
  yield* Fiber.interrupt(gone)
  yield* TestClock.adjust(1_000)
  yield* Fiber.join(open)
  yield* Fiber.join(third)
  expect(order).toEqual(['page 1', 'page 2', 'jump', 'open', 'page 3'])
  const together = yield* Effect.forkChild(Effect.forEach([1, 2, 3], () => queue.run('interactive', 'conversations.replies', Clock.currentTimeMillis), { concurrency: 'unbounded' }))
  yield* TestClock.adjust(0)
  expect(yield* Fiber.join(together)).toEqual([1_000, 1_000, 1_000])
}).pipe(Effect.provide(RequestQueue.layer)))

itEffect('a page leaves the last two interactive tokens to the user', () => Effect.gen(function* () {
  const queue = yield* RequestQueue
  yield* Effect.forEach(Array.from({ length: 18 }), () => queue.run('interactive', 'conversations.replies', Effect.void))
  const page = yield* Effect.forkChild(queue.run('paging', 'conversations.replies', Clock.currentTimeMillis))
  yield* TestClock.adjust(0)
  expect(yield* queue.run('interactive', 'conversations.replies', Clock.currentTimeMillis)).toBe(0)
  // One token left: the page waits for two more, at one per 500 ms.
  yield* TestClock.adjust(1_000)
  expect(yield* Fiber.join(page)).toBe(1_000)
}).pipe(Effect.provide(RequestQueue.layer)))
