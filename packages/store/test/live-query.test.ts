import { describe, expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect, Exit, Option, Queue, Ref, Result, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { DEFAULT_LIVE_QUERY_DEBOUNCE, invalidate, liveQuery, StoreReader, StoreWriter, transaction } from '../src/index'
import { collect, freshStore, settle, takeValue } from './helpers'

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
    expect(Option.isNone(yield* Queue.poll(queue))).toBe(true)
  })

describe('live queries', () => {
  itEffect('emit a snapshot at once and re-emit after a transaction that invalidates their keys', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery({ messages: ['C1'] }, countMessages('C1')))
      const users = yield* collect(liveQuery(['users'], countUsers))
      expect(yield* takeValue(messages)).toBe(0)
      expect(yield* takeValue(users)).toBe(0)
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000001'))

      expect(yield* takeValue(messages)).toBe(1)
      yield* expectNoEmission(users)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('a table-level key matches writes to any row; a row-level key only its own rows', () =>
    Effect.gen(function* () {
      const all = yield* collect(liveQuery(['messages'], countMessages('C2')))
      const c1 = yield* collect(liveQuery({ messages: ['C1'] }, countMessages('C1')))
      yield* takeValue(all)
      yield* takeValue(c1)
      yield* endWindow

      yield* transaction(insertMessage('C2', '1.000001'))

      expect(yield* takeValue(all)).toBe(1)
      yield* expectNoEmission(c1)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('one subscription can mix row keys and whole tables; an empty id list is the whole table', () =>
    Effect.gen(function* () {
      const mixed = yield* collect(liveQuery({ messages: ['C1'], users: [] }, countMessages('C1')))
      yield* takeValue(mixed)
      yield* endWindow

      // A row-level write to the table named whole re-runs it.
      yield* transaction(invalidate({ users: ['U1'] }))
      yield* takeValue(mixed)
      yield* endWindow
      // Another channel's messages do not.
      yield* transaction(insertMessage('C2', '1.000001'))
      yield* expectNoEmission(mixed)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('invalidations inside a transaction fire once, after the commit', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* takeValue(messages)
      yield* endWindow

      yield* transaction(
        Effect.gen(function* () {
          yield* insertMessage('C1', '1.000001')
          yield* insertMessage('C1', '1.000002')
          yield* expectNoEmission(messages)
        }),
      )

      expect(yield* takeValue(messages)).toBe(2)
      yield* endWindow
      yield* expectNoEmission(messages)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('a rolled-back transaction fires nothing', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* takeValue(messages)
      yield* endWindow

      const result = yield* transaction(
        Effect.gen(function* () {
          yield* insertMessage('C1', '1.000001')
          return yield* Effect.fail('boom' as const)
        }),
      ).pipe(Effect.result)
      expect(result._tag === 'Failure').toBe(true)

      yield* expectNoEmission(messages)
      expect(yield* countMessages('C1')).toBe(0)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('debounce is leading-edge: the first change runs now, a burst collapses into one trailing run', () =>
    Effect.gen(function* () {
      const messages = yield* collect(liveQuery(['messages'], countMessages('C1')))
      yield* takeValue(messages)
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000001'))
      expect(yield* takeValue(messages)).toBe(1)

      yield* transaction(insertMessage('C1', '1.000002'))
      yield* transaction(insertMessage('C1', '1.000003'))
      yield* transaction(insertMessage('C1', '1.000004'))
      yield* expectNoEmission(messages)

      yield* endWindow
      expect(yield* takeValue(messages)).toBe(4)
      yield* endWindow
      yield* expectNoEmission(messages)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('a failed run is emitted as a value and the subscription stays alive', () =>
    Effect.gen(function* () {
      // The second run fails; every other run counts messages as usual.
      const runs = yield* Ref.make(0)
      const flaky = Effect.gen(function* () {
        const run = yield* Ref.updateAndGet(runs, (n) => n + 1)
        if (run === 2) return yield* Effect.fail({ _tag: 'QueryBroken' as const })
        return yield* countMessages('C1')
      })
      const results = yield* collect(liveQuery(['messages'], flaky))
      expect(yield* Queue.take(results)).toStrictEqual(Result.succeed(0))
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000001'))
      expect(yield* Queue.take(results)).toStrictEqual(Result.fail({ _tag: 'QueryBroken' as const }))
      yield* endWindow

      yield* transaction(insertMessage('C1', '1.000002'))
      expect(yield* Queue.take(results)).toStrictEqual(Result.succeed(2))
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('a defect in a run fails the stream', () =>
    Effect.gen(function* () {
      const exit = yield* liveQuery(['messages'], Effect.die(new Error('bug'))).pipe(Stream.runCollect, Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(freshStore)),
  )
})
