import {
  compareTs,
  maxTs,
  threadTopicId,
  type ChannelId,
  type Ts,
} from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { FollowFence } from '../followFence'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

export interface ThreadSubRow {
  readonly subscribed: boolean
  readonly slackLastRead?: string
  /** Slack's `event_ts` of the last socket event that wrote the row. */
  readonly updatedEventTs?: string
  /** Juno's clock when the row was last observed or changed: a page's request start, an event's arrival, a command and its end. */
  readonly observedAt?: string
  /** A Juno command wrote the row at some point, so a follow event that contradicts it is checked with Slack. */
  readonly commanded: boolean
}

/** Slack's follow state for a thread as the store knows it; `undefined` when Slack has said nothing. */
export const threadSub = (channel: string, threadTs: string): Effect.Effect<ThreadSubRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const fence = yield* FollowFence
    const rows = yield* sql<{ subscribed: 0 | 1; slack_last_read: string | null; updated_event_ts: string | null; observed_at: string | null; commanded: 0 | 1 }>`
      SELECT subscribed, slack_last_read, updated_event_ts, observed_at, commanded FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    const row = rows[0]
    if (row === undefined) return undefined
    const observedAt = fence.effective(channel, threadTs, row.observed_at ?? undefined)
    return {
      subscribed: row.subscribed === 1,
      commanded: row.commanded === 1,
      ...(row.slack_last_read === null ? {} : { slackLastRead: row.slack_last_read }),
      ...(row.updated_event_ts === null ? {} : { updatedEventTs: row.updated_event_ts }),
      ...(observedAt === undefined ? {} : { observedAt }),
    }
  })

/**
 * Who says the follow flag changed, and when (the sync README, "Follow
 * state", has the whole rule):
 *
 * - `event`: a socket event. `eventTs` is Slack's clock and orders events
 *   among themselves; `observedAt` is Juno's clock at arrival.
 * - `page`: a `getView` row, a root on a history or replies page, or a root
 *   lookup. `requestedAt` is Juno's clock when the request started; the page
 *   applies only when that is after the row's `observedAt`.
 * - `command`: Juno's own Subscribe or Unsubscribe, at `at` on Juno's clock.
 *
 * While a command on the thread is pending (an outbox row of kind
 * `follow`), events and pages do not change the flag; they mark the row
 * `seen` so the command refreshes from Slack after its acknowledgement.
 *
 * An event's `event_ts` cannot be ordered against Juno's own command: a
 * frame Slack sent before it accepted the command can arrive after the
 * command's answer. So an event that contradicts a row a command wrote is
 * not applied; the caller asks Slack for the root instead (`lookup`).
 */
export type ThreadSubSource =
  | { readonly kind: 'event'; readonly eventTs: string; readonly observedAt: string }
  | { readonly kind: 'page'; readonly requestedAt: string }
  | { readonly kind: 'command'; readonly at: string }

/** What `setThreadSub` did: wrote the row, left it alone, or found an event it cannot order, so Slack should be asked for the root. */
export type ThreadSubOutcome = 'applied' | 'ignored' | 'lookup'

/** Writes Slack's follow state for a thread. Fires `thread_subs`, which the sidebar query subscribes to. */
export const setThreadSub = (
  channel: string,
  threadTs: string,
  subscribed: boolean,
  slackLastRead: string | undefined,
  source: ThreadSubSource,
): Effect.Effect<ThreadSubOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const existing = yield* threadSub(channel, threadTs)
    if (source.kind === 'event' && existing?.updatedEventTs !== undefined && compareTs(source.eventTs, existing.updatedEventTs) < 0) return 'ignored'
    if (source.kind === 'page' && existing?.observedAt !== undefined && compareTs(source.requestedAt, existing.observedAt) <= 0) return 'ignored'
    if (source.kind !== 'command' && (yield* notePendingFollow(channel, threadTs))) return 'ignored'
    if (source.kind === 'event' && existing?.commanded === true && existing.subscribed !== subscribed) return 'lookup'
    const at = source.kind === 'event' ? source.observedAt : source.kind === 'page' ? source.requestedAt : source.at
    const observedAt = existing?.observedAt === undefined ? at : maxTs(existing.observedAt, at)
    const eventTs = source.kind === 'event' ? source.eventTs : (existing?.updatedEventTs ?? null)
    const commanded = source.kind === 'command' || existing?.commanded === true ? 1 : 0
    const changed = existing?.subscribed !== subscribed || (slackLastRead !== undefined && existing.slackLastRead !== slackLastRead)
    yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed, slack_last_read, updated_event_ts, observed_at, commanded)
      VALUES (${channel}, ${threadTs}, ${subscribed ? 1 : 0}, ${slackLastRead ?? null}, ${eventTs}, ${observedAt}, ${commanded})
      ON CONFLICT (channel, thread_ts) DO UPDATE SET subscribed = excluded.subscribed,
        slack_last_read = COALESCE(excluded.slack_last_read, thread_subs.slack_last_read),
        updated_event_ts = excluded.updated_event_ts, observed_at = excluded.observed_at, commanded = excluded.commanded`
    if (changed) yield* invalidate(syncKeys.threadSubs)
    return 'applied'
  })

/**
 * The `subscribed` and `last_read` a root carries on a page (history,
 * replies and thread views all send them live, research section 3). `true`
 * sets the flag, `false` clears a stored follow, and a root that says
 * nothing changes nothing. A `false` for a thread Slack never mentioned
 * stays unknown, so the sidebar's mention rule still applies to it.
 */
export const applyRootSubscription = (
  channel: string,
  root: { readonly ts: string; readonly subscribed?: boolean; readonly last_read?: string },
  requestedAt: string,
): Effect.Effect<ThreadSubOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (root.subscribed === undefined) return 'ignored'
    if (root.subscribed === false) {
      const existing = yield* threadSub(channel, root.ts)
      if (existing === undefined) return 'ignored'
      const sql = yield* StoreWriter
      // Slack starts following an author once replies arrive. Keep the local
      // author follow before then, unless the user explicitly changed it.
      if (!existing.commanded) {
        const own = yield* sql`SELECT 1 FROM started_threads st JOIN messages m ON m.channel = st.channel AND m.ts = st.root_ts
          WHERE st.channel = ${channel} AND st.root_ts = ${root.ts} AND m.reply_count = 0 LIMIT 1`
        if (own.length > 0) return 'ignored'
      }
    }
    return yield* setThreadSub(channel, root.ts, root.subscribed, root.subscribed ? root.last_read : undefined, { kind: 'page', requestedAt })
  })

/** The topic id an outbox row of kind `follow` targets. */
const followTarget = (channel: string, threadTs: string) => threadTopicId(channel as ChannelId, threadTs as Ts)

/**
 * Juno's Subscribe or Unsubscribe is in flight for a thread: one outbox row
 * of kind `follow` per thread, written in the command's transaction and
 * removed by `endPendingFollow`. Not retried yet (the full outbox is a later
 * milestone); `clearPendingFollows` drops rows a crash left behind.
 */
export const beginPendingFollow = (channel: string, threadTs: string, subscribed: boolean, at: number): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at)
      VALUES ('follow', ${followTarget(channel, threadTs)}, ${JSON.stringify({ subscribed, seen: false })}, ${String(at)})`
  })

/**
 * Ends the pending command on a thread, `at` the command's answer (or
 * failure) on Juno's clock. The row's `observed_at` moves to `at`: a page
 * requested while the command was pending may show Slack from before it
 * accepted the command, so it must not apply after the answer either.
 * Returns whether Slack said anything about the thread meanwhile.
 */
export const endPendingFollow = (channel: string, threadTs: string, at: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const target = followTarget(channel, threadTs)
    const rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    yield* sql`DELETE FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    const sub = yield* threadSub(channel, threadTs)
    if (sub !== undefined) {
      const observedAt = sub.observedAt === undefined ? at : maxTs(sub.observedAt, at)
      yield* sql`UPDATE thread_subs SET observed_at = ${observedAt} WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    }
    return rows.some((row) => (JSON.parse(row.payload_json) as { seen?: boolean }).seen === true)
  })

/** True, and the observation noted, when a command on the thread is pending. */
const notePendingFollow = (channel: string, threadTs: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const target = followTarget(channel, threadTs)
    const rows = yield* sql<{ id: number }>`SELECT id FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    if (rows.length === 0) return false
    yield* sql`UPDATE outbox SET payload_json = json_set(payload_json, '$.seen', json('true')) WHERE kind = 'follow' AND target_key = ${target}`
    return true
  })

/** At sync start: no command is in flight, so `follow` rows are left over from a crash. */
export const clearPendingFollows: Effect.Effect<void, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  yield* sql`DELETE FROM outbox WHERE kind = 'follow'`
})

/** Forgets a `thread_subs` row (the revert of a first subscribe), so Slack's silence is stored as silence again. */
export const clearThreadSub = (channel: string, threadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const fence = yield* FollowFence
    yield* sql`DELETE FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    fence.forget(channel, threadTs)
    yield* invalidate(syncKeys.threadSubs)
  })
