import { threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, syncedRanges, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { addsNothing, mergeRange, type ThreadRange } from '../threadRanges'

import { invalidate, type Writer } from './shared'

/** A thread's proven ranges, oldest first (`threadRanges.ts`). */
export const threadRanges = (channel: string, threadTs: string): Effect.Effect<ReadonlyArray<ThreadRange>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return yield* sql<ThreadRange>`SELECT from_ts, to_ts, tail FROM thread_ranges
      WHERE channel = ${channel} AND thread_ts = ${threadTs} ORDER BY from_ts`
  })

/** Records a range a page proved, merged with the ranges it touches. Nothing when it proved nothing new (`addsNothing`). */
export const addThreadRange = (channel: string, threadTs: string, range: ThreadRange | undefined): Writer =>
  Effect.gen(function* () {
    if (range === undefined) return
    const sql = yield* StoreWriter
    const current = yield* threadRanges(channel, threadTs)
    if (addsNothing(current, range)) return
    const { range: merged, replaced } = mergeRange(current, range)
    if (replaced.length > 0) {
      yield* sql`DELETE FROM thread_ranges WHERE channel = ${channel} AND thread_ts = ${threadTs} AND from_ts IN ${sql.in(replaced.map((r) => r.from_ts))}`
    }
    yield* sql`INSERT INTO thread_ranges (channel, thread_ts, from_ts, to_ts, tail) VALUES (${channel}, ${threadTs}, ${merged.from_ts}, ${merged.to_ts}, ${merged.tail})`
    yield* invalidate({ thread_ranges: [threadTopicId(channel as ChannelId, threadTs as Ts)] })
  })

/**
 * The event stream broke (a socket drop, or a new run of the sync after the
 * app was closed): replies sent since may never arrive as events, so no
 * live tail holds. A followed thread's tail is held: the reconnect pages
 * `getView` over every followed thread with activity since the store was
 * last in step, which brings every unread reply, so its unread count stays
 * exact; a reply read on another client meanwhile may still be missing, so
 * the view no longer shows past the range as continuous. An unfollowed
 * thread's tail ends. Returns the threads' topics: their unread counts may
 * no longer be exact, so the caller re-indexes them.
 */
export const endEventCoverage: Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const ended = yield* sql<{ channel: string; thread_ts: string }>`UPDATE thread_ranges SET tail = CASE WHEN EXISTS (
      SELECT 1 FROM thread_subs s WHERE s.channel = thread_ranges.channel AND s.thread_ts = thread_ranges.thread_ts AND s.subscribed = 1)
    THEN 'held' ELSE 'none' END
    WHERE tail = 'live' OR (tail = 'held' AND NOT EXISTS (
      SELECT 1 FROM thread_subs s WHERE s.channel = thread_ranges.channel AND s.thread_ts = thread_ranges.thread_ts AND s.subscribed = 1))
    RETURNING channel, thread_ts`
  const topics = [...new Set(ended.map((row) => threadTopicId(row.channel as ChannelId, row.thread_ts as Ts)))]
  if (topics.length > 0) yield* invalidate(['thread_ranges'])
  return topics
})

/** The synced range a page covered, merged with the ranges it touches. */
export const addSyncedRange = (channel: string, fromTs: string, toTs: string): Writer =>
  syncedRanges.add({ channel, from_ts: fromTs, to_ts: toTs })

export const latestSyncedRange = (channel: string): Effect.Effect<{ from_ts: string; to_ts: string } | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ from_ts: string; to_ts: string }>`
      SELECT from_ts, to_ts FROM synced_ranges WHERE channel = ${channel} ORDER BY to_ts DESC LIMIT 1`
    return rows[0]
  })

/** The newest stored range for each requested conversation, in one read. */
export const latestSyncedRanges = (channels: ReadonlyArray<string>): Effect.Effect<ReadonlyMap<string, { from_ts: string; to_ts: string }>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (channels.length === 0) return new Map()
    const sql = yield* StoreWriter
    const rows = yield* sql<{ channel: string; from_ts: string; to_ts: string }>`
      SELECT channel, from_ts, to_ts FROM (
        SELECT channel, from_ts, to_ts,
          row_number() OVER (PARTITION BY channel ORDER BY to_ts DESC) AS position
        FROM synced_ranges WHERE channel IN ${sql.in(channels)}
      ) WHERE position = 1`
    return new Map(rows.map((row) => [row.channel, { from_ts: row.from_ts, to_ts: row.to_ts }]))
  })
