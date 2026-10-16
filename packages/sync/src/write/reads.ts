import {
  acknowledgeLocalWrite,
  emptyReadState,
  observeServerRead,
  rejectLocalWrite,
  type ReadOutcome,
  type ReadState,
  type ServerRead,
  type Ts,
} from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

// Read state (architecture 5.6, specs/readstate.qnt). The rules are `@juno/domain`'s
// `observeServerRead` and the local marks; these functions load and store their state.

interface ReadRow {
  readonly last_read_ts: string | null
  readonly marked_unread: 0 | 1
  readonly local_write_ack_ts: string | null
  readonly last_server_event_ts: string | null
  readonly observed_at: string | null
  readonly slack_read_ts: string | null
  readonly commanded: 0 | 1
}

/** What a pending `mark` outbox row sends. */
interface MarkPayload {
  /** The pointer Slack will have. */
  readonly ts: string
  readonly unread: boolean
  /** Mark unread on a thread: the first unread reply, which `subscriptions.thread.mark` takes with `read: 0`. */
  readonly from?: string
  /** Bumped by every local mark that replaces the intent, so the worker knows its answer is for an older one. */
  readonly gen: number
  /** Catch-up marks use the background lane, including after a restart. */
  readonly catchUp?: boolean
  /** Slack said something about the topic while the mark was pending. */
  readonly seen: boolean
}

/** A topic's pending mark: the one `outbox` row of kind `mark` for it. */
export interface PendingMark {
  readonly topicId: string
  readonly lastReadTs: Ts
  readonly unread: boolean
  readonly from?: Ts
  readonly gen: number
  /** Catch-up marks use the background lane, including after a restart. */
  readonly catchUp: boolean
  readonly seen: boolean
  readonly attempts: number
  /** Epoch milliseconds when the worker may send it. */
  readonly nextAt: number
}

const MARK = 'mark'

const toPendingMark = (row: { target_key: string; payload_json: string; attempts: number; next_at: string | null }): PendingMark => {
  const payload = JSON.parse(row.payload_json) as MarkPayload
  return {
    topicId: row.target_key,
    lastReadTs: payload.ts as Ts,
    unread: payload.unread,
    ...(payload.from === undefined ? {} : { from: payload.from as Ts }),
    gen: payload.gen,
    seen: payload.seen,
    catchUp: payload.catchUp ?? false,
    attempts: row.attempts,
    nextAt: row.next_at === null ? 0 : Number(row.next_at),
  }
}

/** The pending mark of a topic, if any. */
export const pendingMark = (topicId: string): Effect.Effect<PendingMark | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ target_key: string; payload_json: string; attempts: number; next_at: string | null }>`
      SELECT target_key, payload_json, attempts, next_at FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    return rows[0] === undefined ? undefined : toPendingMark(rows[0])
  })

/** Every pending mark, the earliest due first. */
export const pendingMarks: Effect.Effect<ReadonlyArray<PendingMark>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<{ target_key: string; payload_json: string; attempts: number; next_at: string | null }>`
    SELECT target_key, payload_json, attempts, next_at FROM outbox WHERE kind = ${MARK} ORDER BY CAST(next_at AS INTEGER), id`
  return rows.map(toPendingMark)
})

/** Juno's read state for a topic, with its pending mark. */
export const readState = (topicId: string): Effect.Effect<ReadState, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<ReadRow>`
      SELECT last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded
      FROM topic_reads WHERE topic_id = ${topicId}`
    const row = rows[0]
    const mark = yield* pendingMark(topicId)
    return {
      ...(row?.last_read_ts ? { lastReadTs: row.last_read_ts as Ts } : {}),
      markedUnread: row?.marked_unread === 1,
      pendingLocalWrite: mark !== undefined,
      ...(mark === undefined ? {} : { intent: { lastReadTs: mark.lastReadTs, unread: mark.unread } }),
      ...(row?.local_write_ack_ts ? { localWriteAckTs: row.local_write_ack_ts as Ts } : {}),
      ...(row?.last_server_event_ts ? { lastServerEventTs: row.last_server_event_ts as Ts } : {}),
      ...(row?.observed_at ? { observedAt: row.observed_at as Ts } : {}),
      ...(row?.slack_read_ts ? { slackReadTs: row.slack_read_ts as Ts } : {}),
      commanded: row?.commanded === 1,
    }
  })

const writeReadState = (topicId: string, state: ReadState): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO topic_reads (topic_id, last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded)
      VALUES (${topicId}, ${state.lastReadTs ?? null}, ${state.markedUnread ? 1 : 0}, ${state.localWriteAckTs ?? null},
        ${state.lastServerEventTs ?? null}, ${state.observedAt ?? null}, ${state.slackReadTs ?? null}, ${state.commanded === true ? 1 : 0})
      ON CONFLICT (topic_id) DO UPDATE SET last_read_ts = excluded.last_read_ts, marked_unread = excluded.marked_unread,
        local_write_ack_ts = excluded.local_write_ack_ts, last_server_event_ts = excluded.last_server_event_ts,
        observed_at = excluded.observed_at, slack_read_ts = excluded.slack_read_ts, commanded = excluded.commanded`
    yield* invalidate(syncKeys.reads(topicId))
  })

/**
 * Cold boot only: a thread the user does not follow starts read at
 * `lastReadTs` the first time Juno sees it. Slack keeps no pointer for such
 * a thread, so this is Juno's own and Slack's stays unknown.
 */
export const seedTopicRead = (topicId: string, lastReadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topicId}`
    if (rows.length > 0) return
    yield* writeReadState(topicId, { ...emptyReadState, lastReadTs: lastReadTs as Ts })
  })

/**
 * Slack's pointer for a topic from an event or a page, applied by
 * `observeServerRead`. A first sight takes Slack's pointer. `noted` marks
 * the pending mark so the engine asks Slack after it ends; `lookup` asks
 * the caller to ask Slack now (`readLookups` for Main, the root for a
 * thread). The caller re-indexes the topic when the outcome is `applied`.
 */
export const observeRead = (topicId: string, read: ServerRead): Effect.Effect<ReadOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const before = yield* readState(topicId)
    const { state, outcome } = observeServerRead(before, read)
    if (outcome === 'applied') yield* writeReadState(topicId, state)
    if (outcome === 'noted') {
      const sql = yield* StoreWriter
      yield* sql`UPDATE outbox SET payload_json = json_set(payload_json, '$.seen', json('true')) WHERE kind = ${MARK} AND target_key = ${topicId}`
    }
    return outcome
  })

/**
 * A local mark (`markReadLocally` or `markUnreadLocally` made `state`): the
 * state, and for a mirrored mark its outbox row, in the caller's
 * transaction. A row already pending takes the new intent (marks coalesce to
 * the last) and keeps its due time; a new row is due `delayMillis` after
 * `now`, so marks in quick succession make one call.
 */
export const writeLocalMark = (topicId: string, state: ReadState, from: Ts | undefined, now: number, delayMillis: number, catchUp = false): Writer =>
  Effect.gen(function* () {
    yield* writeReadState(topicId, state)
    if (!state.pendingLocalWrite || state.intent === undefined) return
    const sql = yield* StoreWriter
    const existing = yield* pendingMark(topicId)
    const payload: MarkPayload = {
      catchUp,
      ts: state.intent.lastReadTs,
      unread: state.intent.unread,
      ...(from === undefined ? {} : { from }),
      gen: (existing?.gen ?? 0) + 1,
      seen: existing?.seen ?? false,
    }
    if (existing === undefined) {
      yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at, next_at)
        VALUES (${MARK}, ${topicId}, ${JSON.stringify(payload)}, ${String(now)}, ${String(now + delayMillis)})`
    } else {
      yield* sql`UPDATE outbox SET payload_json = ${JSON.stringify(payload)} WHERE kind = ${MARK} AND target_key = ${topicId}`
    }
  })

/**
 * Slack accepted `sent`, the mark of generation `gen` with Slack's new
 * pointer, answered at `at` (Juno's clock). When no newer local mark
 * replaced it, the row ends; `seen` says Slack said something meanwhile, so
 * the caller asks Slack. Otherwise the row stays, due now, and is sent
 * again with its newer intent.
 */
export const endMark = (
  topicId: string,
  sent: { readonly gen: number; readonly lastReadTs: Ts },
  at: Ts,
): Effect.Effect<{ readonly done: boolean; readonly seen: boolean }, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const mark = yield* pendingMark(topicId)
    const done = mark === undefined || mark.gen === sent.gen
    if (mark !== undefined && done) yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    if (!done) yield* sql`UPDATE outbox SET attempts = 0, next_at = ${String(0)}, last_error = NULL WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* writeReadState(topicId, acknowledgeLocalWrite(yield* readState(topicId), sent.lastReadTs, at, done))
    return { done, seen: done && mark?.seen === true }
  })

/**
 * Slack refused the mark of generation `gen` at `at`. When no newer mark
 * replaced it, the row ends and Slack's pointer is no longer known, so the
 * caller asks Slack and its answer applies. Returns whether the row ended.
 */
export const rejectMark = (topicId: string, gen: number, at: Ts): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const mark = yield* pendingMark(topicId)
    if (mark === undefined) return false
    if (mark.gen !== gen) {
      yield* sql`UPDATE outbox SET next_at = ${String(0)} WHERE kind = ${MARK} AND target_key = ${topicId}`
      return false
    }
    yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* writeReadState(topicId, rejectLocalWrite(yield* readState(topicId), at))
    return true
  })

/** A transient failure: the row keeps its intent and is due again at `nextAt` (epoch milliseconds). */
export const deferMark = (topicId: string, nextAt: number, error: string): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET attempts = attempts + 1, next_at = ${String(nextAt)}, last_error = ${error} WHERE kind = ${MARK} AND target_key = ${topicId}`
  })

/** Mirroring was turned off: the row is dropped and the mark stays local. */
export const dropMark = (topicId: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* invalidate(syncKeys.reads(topicId))
  })
