import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ftsQuery, searchMessages, StoreWriter, transaction } from '../src/index'
import { freshStore } from './helpers'

const insert = (channel: string, ts: string, text: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO messages (channel, ts, text) VALUES (${channel}, ${ts}, ${text})`
  })

describe('message search', () => {
  it.effect('finds an inserted message by a word in its text', () =>
    Effect.gen(function* () {
      yield* transaction(
        Effect.gen(function* () {
          yield* insert('C1', '1.000001', 'The deploy to staging finished')
          yield* insert('C1', '1.000002', 'Lunch at noon?')
        }),
      )

      const hits = yield* searchMessages('staging deploy')
      assert.deepStrictEqual(
        hits.map((h) => h.ts),
        ['1.000001'],
      )
      assert.strictEqual(hits[0]?.text, 'The deploy to staging finished')
      assert.deepStrictEqual(yield* searchMessages('breakfast'), [])
      assert.deepStrictEqual(yield* searchMessages('   '), [])
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('follows edits and ignores tombstones', () =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* transaction(insert('C1', '1.000001', 'first wording'))
      yield* transaction(sql`UPDATE messages SET text = 'second wording' WHERE ts = '1.000001'`)
      assert.deepStrictEqual(yield* searchMessages('first'), [])
      assert.strictEqual((yield* searchMessages('second')).length, 1)

      yield* transaction(sql`UPDATE messages SET deleted = 1 WHERE ts = '1.000001'`)
      assert.deepStrictEqual(yield* searchMessages('second'), [])
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('never raises a syntax error on user input', () =>
    Effect.gen(function* () {
      yield* transaction(insert('C1', '1.000001', 'what about "quotes" AND OR NOT (parens)*'))
      assert.strictEqual(ftsQuery('a "b" c'), '"a" """b""" "c"')
      assert.strictEqual((yield* searchMessages('"quotes" AND (parens)*')).length, 1)
      assert.strictEqual((yield* searchMessages('OR NOT')).length, 1)
    }).pipe(Effect.provide(freshStore)),
  )
})
