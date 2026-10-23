// An update keeps cache.db: new cache migrations run on the populated file
// and its rows stay. Only a change of CACHE_RESET_EPOCH empties it
// (reset.test.ts).
import { SqliteClient } from '@effect/sql-sqlite-node'
import { expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  CACHE_RESET_EPOCH,
  cacheMigrations,
  Invalidation,
  migrate,
  MIGRATIONS_TABLE,
  searchMessages,
  Store,
  StoreWriter,
  workspacePathsFromDir,
} from '../src/index'
import { tempWorkspaceDir } from './helpers'

const count = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM ${sql(table)}`
    return rows[0]?.n ?? 0
  })

const recordedCacheMigrations = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<{ name: string }>`SELECT name FROM ${sql(`cache.${MIGRATIONS_TABLE}`)} ORDER BY migration_id`
  return rows.map((row) => row.name)
})

itEffect('a populated cache keeps its rows when a later build adds a cache migration', () =>
  Effect.gen(function* () {
    const paths = workspacePathsFromDir(yield* tempWorkspaceDir)

    yield* Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* sql`INSERT INTO messages (channel, ts, text) VALUES ('C1', '1.000001', 'kept across the update')`
      yield* sql`INSERT INTO users (id, name) VALUES ('U1', 'leo')`
      yield* sql`INSERT INTO topic_index (topic_id, channel, kind) VALUES ('C1:main', 'C1', 'main')`
    }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)

    const later = {
      ...cacheMigrations,
      '209901010000_later': Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE messages ADD COLUMN later TEXT NOT NULL DEFAULT 'filled'`
      }),
    }
    const reopen = <A, E>(check: Effect.Effect<A, E, StoreWriter>) =>
      check.pipe(Effect.provide(Store.layer(paths, { cacheMigrations: later })), Effect.scoped)

    yield* reopen(
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        expect(yield* count('messages')).toBe(1)
        expect(yield* count('users')).toBe(1)
        expect(yield* count('topic_index')).toBe(1)
        const rows = yield* sql<{ text: string; later: string }>`SELECT text, later FROM messages`
        expect(rows).toStrictEqual([{ text: 'kept across the update', later: 'filled' }])
        expect((yield* recordedCacheMigrations).at(-1)).toBe('later')
        const [epoch] = yield* sql<{ user_version: number }>`PRAGMA cache.user_version`
        expect(epoch?.user_version).toBe(CACHE_RESET_EPOCH)
      }),
    )

    // A third open finds nothing to run and still keeps the rows.
    yield* reopen(
      Effect.gen(function* () {
        expect(yield* count('messages')).toBe(1)
        expect((yield* recordedCacheMigrations).length).toBe(Object.keys(later).length)
      }),
    )
  }),
)

itEffect('every cache migration after the first runs on a populated cache and keeps its rows', () =>
  Effect.gen(function* () {
    const paths = workspacePathsFromDir(yield* tempWorkspaceDir)
    const [first, ...rest] = Object.keys(cacheMigrations).toSorted()
    expect(first).toBeDefined()
    expect(rest.length).toBeGreaterThan(0)

    // A cache as the first build left it, at the current epoch.
    yield* Effect.gen(function* () {
      const invalidation = yield* Invalidation
      yield* Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.make({ filename: paths.cacheDb })
        yield* Effect.provideService(migrate({ [first!]: cacheMigrations[first!]! }), SqlClient.SqlClient, sql)
        yield* sql`INSERT INTO conversations (id, kind, name) VALUES ('C1', 'public', 'deploys')`
        yield* sql`INSERT INTO users (id, name, display_name, real_name) VALUES ('U1', 'leo', 'Leo', 'Leo Park')`
        yield* sql`INSERT INTO messages (channel, ts, user_id, text) VALUES ('C1', '1.000001', 'U1', 'staging deploy is green')`
        yield* sql`INSERT INTO topic_index (topic_id, channel, kind, preview_json) VALUES ('C1:main', 'C1', 'main', '{"rootText":"release notes"}')`
        yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed) VALUES ('C1', '1.000001', 1)`
        yield* sql`INSERT INTO thread_cursors (channel, thread_ts) VALUES ('C1', '1.000001')`
        yield* sql`PRAGMA user_version = ${sql.literal(String(CACHE_RESET_EPOCH))}`
      }),
      ).pipe(invalidation.provideReactivity)
    }).pipe(Effect.provide(Invalidation.layer))

    yield* Effect.gen(function* () {
      const sql = yield* StoreWriter
      expect(yield* recordedCacheMigrations).toStrictEqual(Object.keys(cacheMigrations).toSorted().map((id) => id.slice(13)))
      for (const table of ['conversations', 'users', 'messages', 'topic_index', 'thread_subs', 'thread_cursors']) {
        expect(yield* count(table)).toBe(1)
      }
      // The search indexes the later migrations add cover the rows that were already there.
      expect((yield* searchMessages('staging deploy')).length).toBe(1)
      const channels = yield* sql<{ n: number }>`SELECT count(*) AS n FROM channels_fts WHERE channels_fts MATCH 'deploys'`
      expect(channels[0]?.n).toBe(1)
      const people = yield* sql<{ n: number }>`SELECT count(*) AS n FROM people_fts WHERE people_fts MATCH 'park'`
      expect(people[0]?.n).toBe(1)
      const titles = yield* sql<{ n: number }>`SELECT count(*) AS n FROM topic_titles_fts WHERE topic_titles_fts MATCH 'release'`
      expect(titles[0]?.n).toBe(1)
      const follow = yield* sql<{ commanded: number }>`SELECT commanded FROM thread_subs`
      expect(follow).toStrictEqual([{ commanded: 0 }])
    }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)
  }),
)
