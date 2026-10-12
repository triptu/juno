import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { prefs, StoreReader, StoreWriter, syncedRanges, syncState, transaction } from '../src/index'
import { freshStore } from './helpers'

const readCount = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages`
  return rows[0]?.n ?? 0
})

describe('reader connection', () => {
  it.effect('sees rows the writer committed, and not rows of an open transaction', () =>
    Effect.gen(function* () {
      const writer = yield* StoreWriter
      assert.strictEqual(yield* readCount, 0)

      yield* transaction(
        Effect.gen(function* () {
          yield* writer`INSERT INTO messages (channel, ts, text) VALUES ('C1', '1.000001', 'one')`
          // WAL: the reader keeps its snapshot while the writer's transaction is open.
          assert.strictEqual(yield* readCount, 0)
        }),
      )

      assert.strictEqual(yield* readCount, 1)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('refuses writes', () =>
    Effect.gen(function* () {
      const reader = yield* StoreReader
      const result = yield* reader`INSERT INTO prefs (key, value_json) VALUES ('k', '1')`.pipe(Effect.result)
      assert.isTrue(result._tag === 'Failure')
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('one transaction can write to both databases', () =>
    Effect.gen(function* () {
      yield* transaction(
        Effect.gen(function* () {
          yield* prefs.set('theme', 'dark')
          yield* syncState.set('cursor', { C1: '1.000001' })
        }),
      )
      assert.strictEqual(yield* prefs.get<string>('theme'), 'dark')
      assert.deepStrictEqual(yield* syncState.get('cursor'), { C1: '1.000001' })
      assert.isUndefined(yield* prefs.get('missing'))
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('synced ranges merge when they touch', () =>
    Effect.gen(function* () {
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '1.000000', to_ts: '2.000000' }))
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '5.000000', to_ts: '6.000000' }))
      yield* transaction(syncedRanges.add({ channel: 'C1', from_ts: '1.500000', to_ts: '5.500000' }))
      yield* transaction(syncedRanges.add({ channel: 'C2', from_ts: '1.000000', to_ts: '1.000000' }))

      const ranges = yield* syncedRanges.list('C1')
      assert.deepStrictEqual(ranges, [{ channel: 'C1', from_ts: '1.000000', to_ts: '6.000000' }])
    }).pipe(Effect.provide(freshStore)),
  )
})
