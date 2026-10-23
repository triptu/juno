import { describe, expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect } from 'effect'
import { searchMessages, StoreWriter, transaction } from '../src/index'
import { freshStore } from './helpers'

const insert = (channel: string, ts: string, text: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO messages (channel, ts, text) VALUES (${channel}, ${ts}, ${text})`
  })

describe('message search', () => {
  itEffect('finds an inserted message by a word in its text', () =>
    Effect.gen(function* () {
      yield* transaction(
        Effect.gen(function* () {
          yield* insert('C1', '1.000001', 'The deploy to staging finished')
          yield* insert('C1', '1.000002', 'Lunch at noon?')
        }),
      )

      const hits = yield* searchMessages('staging deploy')
      expect(hits.map((h) => h.ts)).toStrictEqual(['1.000001'])
      expect(hits[0]?.text).toBe('The deploy to staging finished')
      expect(yield* searchMessages('breakfast')).toStrictEqual([])
      expect(yield* searchMessages('   ')).toStrictEqual([])
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('follows edits and ignores tombstones', () =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* transaction(insert('C1', '1.000001', 'first wording'))
      yield* transaction(sql`UPDATE messages SET text = 'second wording' WHERE ts = '1.000001'`)
      expect(yield* searchMessages('first')).toStrictEqual([])
      expect((yield* searchMessages('second')).length).toBe(1)

      yield* transaction(sql`UPDATE messages SET deleted = 1 WHERE ts = '1.000001'`)
      expect(yield* searchMessages('second')).toStrictEqual([])
    }).pipe(Effect.provide(freshStore)),
  )

  itEffect('never raises a syntax error on user input', () =>
    Effect.gen(function* () {
      yield* transaction(insert('C1', '1.000001', 'what about "quotes" AND OR NOT (parens)*'))
      expect((yield* searchMessages('"quotes" AND (parens)*')).length).toBe(1)
      expect((yield* searchMessages('OR NOT')).length).toBe(1)
    }).pipe(Effect.provide(freshStore)),
  )
})
