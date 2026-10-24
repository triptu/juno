import {
  compareTs,
  threadTopicId,
  type ChannelId,
  type Ts,
} from '@juno/domain'
import { Invalidation, StoreWriter, syncedRanges, type SqlError } from '@juno/store'
import { Effect } from 'effect'

import { invalidate, type Writer } from './shared'

/** What the store knows about a thread's coverage: all replies, or all replies from `completeFrom` on. */
export const markRepliesComplete = (channel: string, threadTs: string, complete: boolean, syncedAt: number, completeFrom?: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const current = (yield* sql<{ replies_complete: 0 | 1; complete_from: string | null }>`
      SELECT replies_complete, complete_from FROM thread_cursors WHERE channel = ${channel} AND thread_ts = ${threadTs}`)[0]
    const nextFrom = completeFrom === undefined
      ? (current?.complete_from ?? null)
      : current?.complete_from === undefined || current.complete_from === null || compareTs(completeFrom, current.complete_from) < 0
        ? completeFrom
        : current.complete_from
    if (current !== undefined && current.replies_complete === (complete ? 1 : 0) && current.complete_from === nextFrom) return
    yield* sql`INSERT INTO thread_cursors (channel, thread_ts, replies_complete, synced_at, complete_from)
      VALUES (${channel}, ${threadTs}, ${complete ? 1 : 0}, ${String(syncedAt)}, ${completeFrom ?? null})
      ON CONFLICT (channel, thread_ts) DO UPDATE SET replies_complete = excluded.replies_complete, synced_at = excluded.synced_at,
        complete_from = CASE
          WHEN excluded.complete_from IS NULL THEN thread_cursors.complete_from
          WHEN thread_cursors.complete_from IS NULL THEN excluded.complete_from
          WHEN excluded.complete_from < thread_cursors.complete_from THEN excluded.complete_from
          ELSE thread_cursors.complete_from END`
    yield* invalidate({ thread_cursors: [threadTopicId(channel as ChannelId, threadTs as Ts)] })
  })

/**
 * The socket dropped: replies sent during the gap may never arrive as
 * events, so "every reply from `complete_from` on is stored" stops being
 * known for threads the user does not follow. Followed threads keep it: the
 * reconnect pages `getView` over every thread with activity since the store
 * was last in step and marks their coverage again from Slack's pointer, and
 * a followed thread with no activity since then missed nothing.
 * Returns the threads' topics: their unread counts may no longer be exact,
 * so the caller re-indexes them.
 */
export const endEventCoverage: Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const ended = yield* sql<{ channel: string; thread_ts: string }>`UPDATE thread_cursors SET complete_from = NULL
    WHERE complete_from IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM thread_subs s WHERE s.channel = thread_cursors.channel AND s.thread_ts = thread_cursors.thread_ts AND s.subscribed = 1)
    RETURNING channel, thread_ts`
  yield* invalidate(['thread_cursors'])
  return ended.map((row) => threadTopicId(row.channel as ChannelId, row.thread_ts as Ts))
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
