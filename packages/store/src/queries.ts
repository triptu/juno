/**
 * The few typed helpers the sync and topics work needs now. Feature queries
 * belong to their engine feature folder; the store does not shape data for
 * the UI.
 */
import { maxTs, minTs } from '@juno/slack-schema'
import { Effect } from 'effect'
import type { SqlError } from 'effect/sql/SqlError'
import { StoreReader, StoreWriter } from './clients'
import { type InvalidationKeys, Invalidation } from './invalidation'
import type { SyncedRangeRow } from './rows'

/** Invalidation keys for the key-value tables. */
export const keys = {
  syncState: ['sync_state'] satisfies InvalidationKeys,
  prefs: ['prefs'] satisfies InvalidationKeys,
  topicArt: ['topic_art'] satisfies InvalidationKeys,
  aiCache: ['ai_cache'] satisfies InvalidationKeys,
  aiCalls: ['ai_calls'] satisfies InvalidationKeys,
  topicVisits: ['topic_visits'] satisfies InvalidationKeys,
  followUps: ['follow_ups'] satisfies InvalidationKeys,
  sidebarViews: ['sidebar_views'] satisfies InvalidationKeys,
  automatedChannels: ['automated_channels'] satisfies InvalidationKeys,
  automatedMoves: ['automated_moves'] satisfies InvalidationKeys,
  automatedHolds: ['automated_holds'] satisfies InvalidationKeys,
  syncedRanges: (channel: string) => ({ synced_ranges: [channel] }) satisfies InvalidationKeys,
  messages: (channel: string) => ({ messages: [channel] }) satisfies InvalidationKeys,
}

/**
 * Turns free text into an FTS5 query: every whitespace-separated word becomes
 * a quoted phrase, so punctuation and FTS operators in user input never raise
 * a syntax error. Words are ANDed.
 */
export const ftsQuery = (text: string): string =>
  text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replaceAll('"', '""')}"`)
    .join(' ')

export interface SearchHit {
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly text: string
}

/**
 * Full-text search over message text, best match first, tombstones excluded.
 * Returns an empty array for an empty query.
 */
export const searchMessages = (
  text: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<SearchHit>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const query = ftsQuery(text)
    if (query === '') return []
    const sql = yield* StoreReader
    return yield* sql<SearchHit>`
      SELECT m.channel, m.ts, m.thread_ts, m.text
      FROM messages_fts f
      JOIN messages m ON m.rowid = f.rowid
      WHERE messages_fts MATCH ${query} AND m.deleted = 0
      ORDER BY f.rank
      LIMIT ${options?.limit ?? 50}`
  })

/** A JSON value in a key-value table, read from the given connection. */
const getJson = <A>(table: 'sync_state' | 'prefs', key: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM ${sql(table)} WHERE key = ${key}`
    const row = rows[0]
    return row === undefined ? undefined : (JSON.parse(row.value_json) as A)
  })

/** A JSON value in a key-value table, written on the writer and invalidating the table. */
const setJson = (table: 'sync_state' | 'prefs', key: string, value: unknown) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const invalidation = yield* Invalidation
    const value_json = JSON.stringify(value)
    yield* sql`INSERT INTO ${sql(table)} (key, value_json) VALUES (${key}, ${value_json})
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
    yield* invalidation.invalidate([table])
  })

/** `sync_state` in cache.db: cursors and other sync bookkeeping, as JSON per key. */
export const syncState = {
  get: <A = unknown>(key: string): Effect.Effect<A | undefined, SqlError, StoreReader> => getJson<A>('sync_state', key),
  set: (key: string, value: unknown): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
    setJson('sync_state', key, value),
}

/** `prefs` in user.db: user preferences as JSON per key. */
export const prefs = {
  get: <A = unknown>(key: string): Effect.Effect<A | undefined, SqlError, StoreReader> => getJson<A>('prefs', key),
  set: (key: string, value: unknown): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
    setJson('prefs', key, value),
}

/**
 * `synced_ranges` in cache.db: the stretches of a channel's history that
 * pages have covered. Only pages extend them; socket events never do.
 */
export const syncedRanges = {
  list: (channel: string): Effect.Effect<ReadonlyArray<SyncedRangeRow>, SqlError, StoreReader> =>
    Effect.gen(function* () {
      const sql = yield* StoreReader
      return yield* sql<SyncedRangeRow>`
        SELECT channel, from_ts, to_ts FROM synced_ranges WHERE channel = ${channel} ORDER BY from_ts`
    }),
  /** Records a range a page covered, merging it with ranges it touches. */
  add: (range: SyncedRangeRow): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      const invalidation = yield* Invalidation
      const touching = yield* sql<SyncedRangeRow>`
        SELECT channel, from_ts, to_ts FROM synced_ranges
        WHERE channel = ${range.channel} AND from_ts <= ${range.to_ts} AND to_ts >= ${range.from_ts}`
      let from_ts = range.from_ts
      let to_ts = range.to_ts
      for (const r of touching) {
        from_ts = minTs(from_ts, r.from_ts)
        to_ts = maxTs(to_ts, r.to_ts)
      }
      if (touching.length > 0) {
        yield* sql`DELETE FROM synced_ranges
          WHERE channel = ${range.channel} AND from_ts IN ${sql.in(touching.map((r) => r.from_ts))}`
      }
      yield* sql`INSERT INTO synced_ranges (channel, from_ts, to_ts) VALUES (${range.channel}, ${from_ts}, ${to_ts})`
      yield* invalidation.invalidate(keys.syncedRanges(range.channel))
    }),
}
