import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_LIVE_QUERY_DEBOUNCE,
  liveQuery,
  prefs,
  Store,
  StoreReader,
  StoreWriter,
  transaction,
  workspacePathsFromDir,
} from '../src/index'
import { collect, freshStore, takeValue, tempWorkspaceDir } from './helpers'

const countMessages = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages`
  return rows[0]?.n ?? 0
})

const seed = Effect.gen(function* () {
  const sql = yield* StoreWriter
  yield* prefs.set('theme', 'dark')
  yield* sql`INSERT INTO messages (channel, ts, text) VALUES ('C1', '1.000001', 'mirror')`
})

describe('reset local cache', () => {
  it.effect('recreates cache.db, keeps user.db, and re-runs live queries', () =>
    Effect.gen(function* () {
      const store = yield* Store
      yield* transaction(seed)
      const live = yield* collect(liveQuery(['messages'], countMessages))
      assert.strictEqual(yield* takeValue(live), 1)
      yield* TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)

      yield* store.resetCache

      assert.strictEqual(yield* takeValue(live), 0)
      assert.strictEqual(yield* countMessages, 0)
      assert.strictEqual(yield* prefs.get<string>('theme'), 'dark')

      // Both connections still work on the new file.
      const sql = yield* StoreWriter
      yield* transaction(sql`INSERT INTO messages (channel, ts, text) VALUES ('C1', '2.000001', 'after')`)
      assert.strictEqual(yield* countMessages, 1)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('a cache.db with another schema version is recreated on open', () =>
    Effect.gen(function* () {
      const dir = yield* tempWorkspaceDir
      const paths = workspacePathsFromDir(dir)

      yield* transaction(seed).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)

      yield* Effect.sync(() => {
        const db = new DatabaseSync(paths.cacheDb)
        db.exec('PRAGMA user_version = 999')
        db.close()
      })

      yield* Effect.gen(function* () {
        assert.strictEqual(yield* countMessages, 0)
        assert.strictEqual(yield* prefs.get<string>('theme'), 'dark')
      }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)
    }),
  )
})
