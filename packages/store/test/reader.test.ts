import { describe, expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect } from 'effect'
import { prefs, StoreReader, StoreWriter, syncedRanges, syncState, transaction } from '../src/index'
import { freshStore } from './helpers'

const readCount = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages`
  return rows[0]?.n ?? 0
})

describe('reader connection', () => {
  itEffect('sees rows the writer committed, and not rows of an open transaction', () =>
    Effect.gen(function* () {
      const writer = yield* StoreWriter
      expect(yield* readCount).toBe(0)

      yield* transaction(
        Effect.gen(function* () {
          yield* writer`INSERT INTO messages (channel, ts, text) VALUES ('C1', '1.000001', 'one')`
          // WAL: the reader keeps its snapshot while the writer's transaction is open.
          expect(yield* readCount).toBe(0)
        }),
      )

      expect(yield* readCount).toBe(1)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('refuses writes', () =>
    Effect.gen(function* () {
      const reader = yield* StoreReader
      const result = yield* reader`INSERT INTO prefs (key, value_json) VALUES ('k', '1')`.pipe(Effect.result)
      expect(result._tag === 'Failure').toBe(true)
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('one transaction writes to both databases, or to neither', () =>
    Effect.gen(function* () {
      const failed = yield* transaction(
        Effect.gen(function* () {
          yield* prefs.set('theme', 'light')
          yield* syncState.set('cursor', { C1: '0.000001' })
          return yield* Effect.fail('after both writes')
        }),
      ).pipe(Effect.result)
      expect(failed._tag === 'Failure').toBe(true)
      expect(yield* prefs.get('theme')).toBeUndefined()
      expect(yield* syncState.get('cursor')).toBeUndefined()

      yield* transaction(
        Effect.gen(function* () {
          yield* prefs.set('theme', 'dark')
          yield* syncState.set('cursor', { C1: '1.000001' })
        }),
      )
      expect(yield* prefs.get<string>('theme')).toBe('dark')
      expect(yield* syncState.get('cursor')).toStrictEqual({ C1: '1.000001' })
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('synced ranges merge when they touch', () =>
    Effect.gen(function* () {
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '1.000000', to_ts: '2.000000' }))
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '5.000000', to_ts: '6.000000' }))
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '1.500000', to_ts: '5.500000' }))
      yield* transaction(syncedRanges.add({ channel: 'C2', from_ts: '1.000000', to_ts: '1.000000' }))

      const ranges = yield* syncedRanges.list('C1')
      expect(ranges).toStrictEqual([{ channel: 'C1', from_ts: '1.000000', to_ts: '6.000000' }])
    }).pipe(Effect.provide(freshStore)),
  )
})
