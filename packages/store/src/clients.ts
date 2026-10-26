/**
 * The two connections of one workspace.
 *
 * `StoreWriter` opens `user.db`, runs its migrations, prepares `cache.db`
 * (reset epoch check, migrations) and attaches it as `cache`, so one transaction
 * can span both files. `StoreReader` is a second, read-only connection with
 * the same attachment; live queries run on it so a long writer transaction
 * never blocks a read. Both are plain `SqlClient`s; the service type says
 * which connection a query runs on. `Store` owns the lifecycle operations
 * (reset the cache).
 */
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import type { MigrationError } from 'effect/sql/Migrator'
import { SqlError } from 'effect/sql/SqlError'
import * as fs from 'node:fs/promises'
import { Invalidation } from './invalidation'
import { migrate } from './migrate'
import { CACHE_RESET_EPOCH, cacheMigrations } from './migrations/cache'
import { userMigrations } from './migrations/user'
import { StorePaths, type WorkspacePaths } from './paths'

/**
 * How long a connection waits for a lock before failing with
 * `LockTimeoutError`. SQLite's wait blocks the event loop, so it is short and
 * `transaction` retries in Effect instead.
 */
export const BUSY_TIMEOUT: Duration.Input = '250 millis'

/** The schema name `cache.db` is attached under. Table names are unique across both files, so queries rarely need it. */
export const CACHE_SCHEMA = 'cache'

/** A file operation on the workspace directory failed. */
export class StoreIoError extends Schema.TaggedError<StoreIoError>()('StoreIoError', {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export type StoreError = SqlError | MigrationError | StoreIoError

type Migrations = Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>

/**
 * The migrations `cache.db` is brought up to when the store opens. Always
 * `cacheMigrations`, except in a test that plays a later build with one
 * more migration (`Store.layer(paths, { cacheMigrations })`).
 */
export class CacheMigrations extends Context.Reference<Migrations>('juno/store/CacheMigrations', {
  defaultValue: () => cacheMigrations,
}) {}

interface StoreOptions {
  /** Tests only: the cache migrations of a later build. */
  readonly cacheMigrations?: Migrations
}

/** The writer connection: all writes and transactions. */
export class StoreWriter extends Context.Service<StoreWriter, SqlClient.SqlClient>()('juno/store/StoreWriter') {
  static readonly layer: Layer.Layer<StoreWriter, StoreError, StorePaths | Invalidation> = Layer.effect(
    StoreWriter,
    Effect.gen(function* () {
      const paths = yield* StorePaths
      const invalidation = yield* Invalidation
      const migrations = yield* CacheMigrations
      yield* io(paths.dir, () => fs.mkdir(paths.dir, { recursive: true }))
      yield* io(paths.uploads, () => fs.mkdir(paths.uploads, { recursive: true }))
      yield* prepareCache(paths, invalidation, migrations)
      const sql = yield* invalidation.provideReactivity(
        SqliteClient.make({ filename: paths.userDb, busyTimeout: BUSY_TIMEOUT }),
      )
      yield* Effect.provideService(migrate(userMigrations), SqlClient.SqlClient, sql)
      yield* attachCache(sql, paths)
      return sql
    }),
  )
}

/** The reader connection: read-only, used by live queries. */
export class StoreReader extends Context.Service<StoreReader, SqlClient.SqlClient>()('juno/store/StoreReader') {
  static readonly layer: Layer.Layer<StoreReader, StoreError, StorePaths | Invalidation | StoreWriter> = Layer.effect(
    StoreReader,
    Effect.gen(function* () {
      const paths = yield* StorePaths
      const invalidation = yield* Invalidation
      // Depends on the writer so user.db exists, is migrated and is in WAL mode.
      yield* StoreWriter
      const sql = yield* invalidation.provideReactivity(
        SqliteClient.make({ filename: paths.userDb, readonly: true, busyTimeout: BUSY_TIMEOUT }),
      )
      yield* attachCache(sql, paths)
      return sql
    }),
  )
}

export class Store extends Context.Service<
  Store,
  {
    readonly paths: WorkspacePaths
    /**
     * "Reset local cache": detaches `cache.db` from both connections, deletes
     * it, recreates it with the current schema and attaches it again, then
     * re-runs every live query. `user.db` is untouched. The caller starts a
     * cold sync afterwards.
     */
    readonly resetCache: Effect.Effect<void, StoreError>
  }
>()('juno/store/Store') {
  static readonly layerNoDeps: Layer.Layer<Store, never, StorePaths | Invalidation | StoreWriter | StoreReader> =
    Layer.effect(
      Store,
      Effect.gen(function* () {
        const paths = yield* StorePaths
        const invalidation = yield* Invalidation
        const writer = yield* StoreWriter
        const reader = yield* StoreReader
        const migrations = yield* CacheMigrations

        const resetCache = Effect.gen(function* () {
          yield* reader`DETACH DATABASE ${reader.literal(CACHE_SCHEMA)}`
          yield* writer`DETACH DATABASE ${writer.literal(CACHE_SCHEMA)}`
          yield* removeDatabaseFiles(paths.cacheDb)
          yield* prepareCache(paths, invalidation, migrations)
          yield* attachCache(writer, paths)
          yield* attachCache(reader, paths)
          yield* invalidation.invalidateAll
        }).pipe(Effect.withSpan('Store.resetCache'))

        return Store.of({ paths, resetCache })
      }),
    )

  /** Everything the store provides for one workspace directory. */
  static readonly layer = (
    paths: WorkspacePaths,
    options: StoreOptions = {},
  ): Layer.Layer<Store | StoreWriter | StoreReader | Invalidation | StorePaths, StoreError> =>
    Store.layerNoDeps.pipe(
      Layer.provideMerge(StoreReader.layer),
      Layer.provideMerge(StoreWriter.layer),
      Layer.provideMerge(Invalidation.layer),
      Layer.provideMerge(StorePaths.layer(paths)),
      Layer.provide(
        options.cacheMigrations === undefined ? Layer.empty : Layer.succeed(CacheMigrations, options.cacheMigrations),
      ),
    )
}

const io = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new StoreIoError({ path, cause }) })

const fileExists = (path: string) =>
  Effect.promise(() =>
    fs.access(path).then(
      () => true,
      () => false,
    ),
  )

/** Deletes a database and its WAL and shared-memory files if present. */
const removeDatabaseFiles = (dbPath: string) =>
  Effect.forEach([dbPath, `${dbPath}-wal`, `${dbPath}-shm`], (p) => io(p, () => fs.rm(p, { force: true })), {
    discard: true,
  })

/**
 * Makes sure `cache.db` exists and is migrated to the current schema. An
 * update keeps the cache: pending migrations run on the existing file and
 * its rows stay. The file is deleted first only when its `user_version` is
 * not `CACHE_RESET_EPOCH` (a change that cannot be migrated), and when
 * SQLite cannot open or migrate it (a damaged file, or one whose WAL no
 * longer matches it): the cache is a copy of Slack and syncs again. Uses a
 * short-lived connection of its own so the Migrator's table lands in
 * `cache.db`, not in `user.db`.
 */
const prepareCache = (
  paths: WorkspacePaths,
  invalidation: Invalidation['Service'],
  migrations: Migrations,
): Effect.Effect<void, StoreError> =>
  Effect.gen(function* () {
    const existed = yield* fileExists(paths.cacheDb)
    if (existed) {
      const epoch = yield* readUserVersion(paths.cacheDb, invalidation).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (epoch !== CACHE_RESET_EPOCH) {
        yield* Effect.logInfo('cache.db reset epoch differs, recreating', { found: epoch, wanted: CACHE_RESET_EPOCH })
        yield* removeDatabaseFiles(paths.cacheDb)
      }
    }
    yield* createCache(paths, invalidation, migrations).pipe(
      Effect.catch((error) =>
        existed && error._tag !== 'StoreIoError'
          ? Effect.gen(function* () {
              yield* Effect.logWarning('cache.db could not be opened or migrated, recreating', { error: error.message })
              yield* removeDatabaseFiles(paths.cacheDb)
              yield* createCache(paths, invalidation, migrations)
            })
          : Effect.fail(error),
      ),
    )
  }).pipe(Effect.withSpan('Store.prepareCache'))

/** Opens `cache.db`, creating it if needed, runs the migrations it has not recorded yet, and drops ephemeral messages. */
const createCache = (
  paths: WorkspacePaths,
  invalidation: Invalidation['Service'],
  migrations: Migrations,
): Effect.Effect<void, StoreError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ filename: paths.cacheDb, busyTimeout: BUSY_TIMEOUT })
      const applied = yield* Effect.provideService(migrate(migrations), SqlClient.SqlClient, sql)
      if (applied.length > 0) yield* Effect.logInfo('cache.db migrated', { applied: applied.map(([id, name]) => `${id}_${name}`) })
      // Ephemeral messages (Slackbot's notes) last until a restart, as in Slack's client: Slack never sends them again.
      yield* sql`DELETE FROM messages WHERE ephemeral = 1`
      yield* sql`PRAGMA user_version = ${sql.literal(String(CACHE_RESET_EPOCH))}`
    }),
  ).pipe(invalidation.provideReactivity)

const readUserVersion = (dbPath: string, invalidation: Invalidation['Service']): Effect.Effect<number, SqlError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqliteClient.make({ filename: dbPath, readonly: true, disableWAL: true })
      const rows = yield* sql<{ user_version: number }>`PRAGMA user_version`
      return rows[0]?.user_version ?? 0
    }),
  ).pipe(invalidation.provideReactivity)

const attachCache = (sql: SqlClient.SqlClient, paths: WorkspacePaths) =>
  sql`ATTACH DATABASE ${paths.cacheDb} AS ${sql.literal(CACHE_SCHEMA)}`.pipe(Effect.asVoid)
