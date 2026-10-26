import { threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, syncedRanges, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { addsNothing, mergeRange, type ThreadRange } from '../threadRanges'

import { invalidate, type Writer } from './shared'

/** A thread's proven ranges, oldest first (`threadRanges.ts`). */
export const threadRanges = (channel: string, threadTs: string): Effect.Effect<ReadonlyArray<ThreadRange>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return yield* sql<ThreadRange>`SELECT kind, from_ts, to_ts, tail, heard_ts FROM thread_ranges
      WHERE channel = ${channel} AND thread_ts = ${threadTs} ORDER BY from_ts`
  })

/** Records a range a page proved, merged with the ranges it touches. Nothing when it proved nothing new (`addsNothing`). */
export const addThreadRange = (channel: string, threadTs: string, range: ThreadRange | undefined): Writer =>
  Effect.gen(function* () {
    if (range === undefined) return
    const sql = yield* StoreWriter
    const current = yield* threadRanges(channel, threadTs)
    if (addsNothing(current, range)) return
    // What the socket delivered after a range it joins stays heard until a page reaches past it (`mergeRange`).
    const { range: merged, replaced } = mergeRange(current, range)
    const gone = replaced.filter((r) => r.from_ts !== merged.from_ts)
    if (gone.length > 0) {
      yield* sql`DELETE FROM thread_ranges WHERE channel = ${channel} AND thread_ts = ${threadTs} AND kind = ${range.kind}
        AND from_ts IN ${sql.in(gone.map((r) => r.from_ts))}`
    }
    // The range that starts where the merged one does is updated in place, so a tail that only moves between
    // `live` and `held` (which count the same) keeps the topic's index up to date (`topic_inputs`).
    yield* sql`INSERT INTO thread_ranges (channel, thread_ts, kind, from_ts, to_ts, tail, heard_ts)
      VALUES (${channel}, ${threadTs}, ${merged.kind}, ${merged.from_ts}, ${merged.to_ts}, ${merged.tail}, ${merged.heard_ts ?? null})
      ON CONFLICT (channel, thread_ts, kind, from_ts) DO UPDATE SET to_ts = excluded.to_ts, tail = excluded.tail, heard_ts = excluded.heard_ts`
    yield* invalidate({ thread_ranges: [threadTopicId(channel as ChannelId, threadTs as Ts)] })
  })

/**
 * A reply the socket delivered: a live range of its thread that starts
 * before it heard it. Events arrive in the order Slack sent them, so when
 * the tail ends every reply up to the newest one heard has arrived, and the
 * view and the count keep them (`threadRanges.ts` `reach`) until a page
 * reads that stretch again. Nothing else moves; the view already shows past
 * a live range.
 */
export const hearReply = (channel: string, threadTs: string, ts: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE thread_ranges SET heard_ts = ${ts}
      WHERE channel = ${channel} AND thread_ts = ${threadTs} AND tail = 'live' AND from_ts < ${ts} AND to_ts < ${ts}
        AND (heard_ts IS NULL OR heard_ts < ${ts})`
  })

/**
 * The event stream broke (a socket drop, or a new run of the sync after the
 * app was closed): replies sent since may never arrive as events, so no
 * live tail holds. Each live range keeps the replies the socket delivered
 * for it (`hearReply`), but its `to_ts` stays where pages proved it, so the
 * next open reads that stretch again. A followed thread's tail is held: the
 * reconnect pages `getView` over every followed thread with activity since
 * the store was last in step, which brings every unread reply, so its
 * unread count stays exact; a reply read on another client meanwhile may
 * still be missing, so the view no longer shows past the range. An
 * unfollowed thread's tail ends. Returns the threads' topics: their unread
 * counts may no longer be exact, so the caller re-indexes them.
 */
export const endEventCoverage: Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const ended = yield* sql<{ channel: string; thread_ts: string }>`UPDATE thread_ranges SET
      tail = CASE WHEN EXISTS (
        SELECT 1 FROM thread_subs s WHERE s.channel = thread_ranges.channel AND s.thread_ts = thread_ranges.thread_ts AND s.subscribed = 1)
      THEN 'held' ELSE 'none' END
    WHERE tail = 'live' OR (tail = 'held' AND NOT EXISTS (
      SELECT 1 FROM thread_subs s WHERE s.channel = thread_ranges.channel AND s.thread_ts = thread_ranges.thread_ts AND s.subscribed = 1))
    RETURNING channel, thread_ts`
  const topics = [...new Set(ended.map((row) => threadTopicId(row.channel as ChannelId, row.thread_ts as Ts)))]
  if (topics.length > 0) yield* invalidate(['thread_ranges'])
  return topics
})

/**
 * The thread is no longer followed: a held tail rested on the reconnect's
 * `getView`, which no longer lists it. The topic's count takes this on its
 * next re-index, which a reply or a page that could change it runs.
 */
export const endHeldTail = (channel: string, threadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const ended = yield* sql<{ from_ts: string }>`UPDATE thread_ranges SET tail = 'none'
      WHERE channel = ${channel} AND thread_ts = ${threadTs} AND tail = 'held' RETURNING from_ts`
    if (ended.length > 0) yield* invalidate({ thread_ranges: [threadTopicId(channel as ChannelId, threadTs as Ts)] })
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
