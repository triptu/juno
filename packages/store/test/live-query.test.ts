import { assert, describe, it } from '@effect/vitest'
import { Effect, Option, Queue } from 'effect'
import { TestClock } from 'effect/testing'
import { DEFAULT_LIVE_QUERY_DEBOUNCE, invalidate, liveQuery, StoreReader, StoreWriter, transaction } from '../src/index'
import { collect, freshStore, settle } from './helpers'

const countMessages = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages WHERE channel = ${channel}`
    return rows[0]?.n ?? 0
  })

const countUsers = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM users`
  return rows[0]?.n ?? 0
})

const insertMessage = (channel: string, ts: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO messages (channel, ts, text) VALUES (${channel}, ${ts}, 'hi')`
    yield* invalidate({ messages: [channel] })
  })

/** Ends the debounce window that follows every run. */
const endWindow = TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)

const expectNoEmission = <A>(queue: Queue.Queue<A>) =>
  Effect.gen(function* () {
    yield* settle
    assert.isTrue(Option.isNone(yield* Queue.poll(queue)))
  })

describe('live queries', () => {
  it.effect('emit a snapshot at once and re-emit after a transaction that invalidates their keys', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery({ messages: ['C1'] }, countMessages('C1')))
      const users = yield* collect(liveQuery(['users'], countUsers))
      assert.strictEqual(yield* Queue.take(messages), 0)
      assert.strictEqual(yield* Queue.take(users), 0)
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000001'))

      assert.strictEqual(yield* Queue.take(messages), 1)
      yield* expectNoEmission(users)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('a table-level key matches writes to any row; a row-level key only its own rows', () =>
    Effect.gen(function* () {
      const all = yield* collect(liveQuery(['messages'], countMessages('C2')))
      const c1 = yield* collect(liveQuery({ messages: ['C1'] }, countMessages('C1')))
      yield* Queue.take(all)
      yield* Queue.take(c1)
      yield* endWindow

      yield* transaction(insertMessage('C2', '1.000001'))

      assert.strictEqual(yield* Queue.take(all), 1)
      yield* expectNoEmission(c1)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('invalidations inside a transaction fire once, after the commit', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* Queue.take(messages)
      yield* endWindow

      yield* transaction(
        Effect.gen(function* () {
          yield* insertMessage('C1', '1.000001')
          yield* insertMessage('C1', '1.000002')
          yield* expectNoEmission(messages)
        }),
      )

      assert.strictEqual(yield* Queue.take(messages), 2)
      yield* endWindow
      yield* expectNoEmission(messages)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('a rolled-back transaction fires nothing', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* Queue.take(messages)
      yield* endWindow

      const result = yield* transaction(
        Effect.gen(function* () {
          yield* insertMessage('C1', '1.000001')
          return yield* Effect.fail('boom' as const)
        }),
      ).pipe(Effect.result)
      assert.isTrue(result._tag === 'Failure')

      yield* expectNoEmission(messages)
      assert.strictEqual(yield* countMessages('C1'), 0)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('debounce is leading-edge: the first change runs now, a burst collapses into one trailing run', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* Queue.take(messages)
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000001'))
      assert.strictEqual(yield* Queue.take(messages), 1)

      yield* transaction(insertMessage('C1', '1.000002'))
      yield* transaction(insertMessage('C1', '1.000003'))
      yield* transaction(insertMessage('C1', '1.000004'))
      yield* expectNoEmission(messages)

      yield* endWindow
      assert.strictEqual(yield* Queue.take(messages), 4)
      yield* endWindow
      yield* expectNoEmission(messages)
    }).pipe(Effect.provide(freshStore)),
  )
})
