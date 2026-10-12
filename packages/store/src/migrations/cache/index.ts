import type { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'
import initial from './202610121200_initial'

/**
 * Schema version of `cache.db`, stored in `PRAGMA user_version`. A cache file
 * with a different version is deleted and recreated when the store opens, and
 * the engine re-syncs. Bump it with every change to the cache migrations; the
 * mirror is disposable, so its migrations only ever run on an empty file and
 * never transform data (ADR 0008).
 */
export const CACHE_SCHEMA_VERSION = 1

/** Migrations for `cache.db`, keyed `<timestamp>_<name>`. */
export const cacheMigrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  '202610121200_initial': initial,
}
