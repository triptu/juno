import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import * as fs from 'node:fs/promises'
import {
  CACHE_SCHEMA_VERSION,
  cacheMigrations,
  migrate,
  MIGRATIONS_TABLE,
  Store,
  StoreWriter,
  userMigrations,
  workspacePathsFromDir,
} from '../src/index'
import { freshStore, tempWorkspaceDir } from './helpers'

const tableNames = (schema: 'main' | 'cache') =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ name: string }>`
      SELECT name FROM ${sql(`${schema}.sqlite_master`)} WHERE type = 'table' ORDER BY name`
    return rows.map((r) => r.name)
  })

it.effect('removes retired cards and summary scheduling while keeping messages and preferences', () =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`CREATE TABLE for_you_cards (id TEXT PRIMARY KEY)`
    yield* sql`INSERT INTO for_you_cards VALUES ('old-card')`
    yield* sql`INSERT INTO prefs (key, value_json) VALUES ('theme', '"dark"')`
    // Restore the old notification schema too: every later migration runs again.
    yield* sql`ALTER TABLE notification_log ADD COLUMN summary_due_at TEXT`
    yield* sql`CREATE INDEX notification_log_pending ON notification_log (summary_due_at) WHERE delivered_at IS NULL AND outcome = 'summary'`
    yield* sql`INSERT INTO notification_log (at, channel, ts, outcome) VALUES ('2026-10-12T08:00:00Z', 'C1', '1.000001', 'summary')`
    yield* sql`DELETE FROM ${sql(MIGRATIONS_TABLE)} WHERE migration_id >= 202610160200`
    yield* Effect.provideService(migrate(userMigrations), SqlClient.SqlClient, sql)
    assert.notInclude(yield* tableNames('main'), 'for_you_cards')
    const columns = yield* sql<{ name: string }>`PRAGMA table_info(notification_log)`
    assert.notInclude(columns.map((column) => column.name), 'summary_due_at')
    const held = yield* sql<{ outcome: string }>`SELECT outcome FROM notification_log WHERE channel = 'C1'`
    assert.deepStrictEqual(held, [{ outcome: 'hold' }])
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'theme'`
    assert.strictEqual(rows[0]?.value_json, '"dark"')
  }).pipe(Effect.provide(freshStore)),
)

describe('migrations', () => {
  it.effect('apply on a fresh directory and create both databases', () =>
    Effect.gen(function* () {
      const store = yield* Store
      const sql = yield* StoreWriter

      const files = yield* Effect.promise(() => fs.readdir(store.paths.dir))
      assert.includeMembers(files, ['cache.db', 'user.db', 'uploads'])

      const userTables = yield* tableNames('main')
      assert.includeMembers(userTables, ['topic_overlay', 'topic_reads', 'outbox', 'drafts', 'prefs', MIGRATIONS_TABLE])
      assert.notInclude(userTables, 'messages')

      const cacheTables = yield* tableNames('cache')
      assert.includeMembers(cacheTables, ['messages', 'messages_fts', 'topic_index', 'synced_ranges', MIGRATIONS_TABLE])
      assert.notInclude(cacheTables, 'prefs')

      const [version] = yield* sql<{ user_version: number }>`PRAGMA cache.user_version`
      assert.strictEqual(version?.user_version, CACHE_SCHEMA_VERSION)

      const [journal] = yield* sql<{ journal_mode: string }>`PRAGMA main.journal_mode`
      assert.strictEqual(journal?.journal_mode, 'wal')
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('are idempotent: running them again applies nothing', () =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      const applied = yield* Effect.provideService(migrate(userMigrations), SqlClient.SqlClient, sql)
      assert.deepStrictEqual(applied, [])

      const recorded = yield* sql<{ n: number }>`SELECT count(*) AS n FROM ${sql(MIGRATIONS_TABLE)}`
      assert.strictEqual(recorded[0]?.n, Object.keys(userMigrations).length)

      const recordedCache = yield* sql<{ n: number }>`SELECT count(*) AS n FROM ${sql(`cache.${MIGRATIONS_TABLE}`)}`
      assert.strictEqual(recordedCache[0]?.n, Object.keys(cacheMigrations).length)
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('reopening the same directory keeps data and applies nothing new', () =>
    Effect.gen(function* () {
      const dir = yield* tempWorkspaceDir
      const paths = workspacePathsFromDir(dir)

      yield* Effect.gen(function* () {
        const sql = yield* StoreWriter
        yield* sql`INSERT INTO prefs (key, value_json) VALUES ('theme', '"dark"')`
        yield* sql`INSERT INTO messages (channel, ts, text) VALUES ('C1', '1.000001', 'kept')`
      }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)

      yield* Effect.gen(function* () {
        const sql = yield* StoreWriter
        const prefs = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'theme'`
        assert.strictEqual(prefs[0]?.value_json, '"dark"')
        const messages = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages`
        assert.strictEqual(messages[0]?.n, 1)
        const recorded = yield* sql<{ n: number }>`SELECT count(*) AS n FROM ${sql(MIGRATIONS_TABLE)}`
        assert.strictEqual(recorded[0]?.n, Object.keys(userMigrations).length)
      }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped)
    }),
  )
})
