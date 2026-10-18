/** Counts enqueue recent cached ranges; a bounded background pass drains them. */
import { compareTs, millisToTs, Ts, type CountEntry } from '@juno/slack-schema'
import { SlackApi } from '@juno/slack'
import { StoreWriter, transaction } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { BootError, BootServices } from './boot'
import { awaitEarlierFetches, type SyncContext } from './context'
import { writeDeleted } from './events'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'

interface Marker { readonly updated: string | null; readonly history_invalid: string | null }
interface Job { readonly id: number; readonly channel: string; readonly thread: string; readonly oldest: string; readonly latest: string; readonly cursor: string | null; readonly boundary: string | null; readonly queued_at: number }
export const REPAIR_CALL_LIMIT = 10

/** These are observed markers; unfinished work lives durably in repair_pending. */
export const saveRepairMarkers = (entries: ReadonlyArray<CountEntry>) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  for (const entry of entries) {
    if (entry.updated === undefined && entry.history_invalid === undefined) continue
    yield* sql`INSERT INTO conversation_repairs (channel, updated, history_invalid)
      VALUES (${entry.id}, ${entry.updated ?? null}, ${entry.history_invalid ?? null})
      ON CONFLICT (channel) DO UPDATE SET
        updated = COALESCE(excluded.updated, conversation_repairs.updated),
        history_invalid = COALESCE(excluded.history_invalid, conversation_repairs.history_invalid)
      WHERE conversation_repairs.updated IS NOT COALESCE(excluded.updated, conversation_repairs.updated)
         OR conversation_repairs.history_invalid IS NOT COALESCE(excluded.history_invalid, conversation_repairs.history_invalid)`
  }
})

/** Missing baselines seed only. Partial counts preserve absent markers; any supplied difference is dirty. */
export const queueRepairs = (ctx: SyncContext, entries: ReadonlyArray<CountEntry>, gapStartedAt: number) => transaction(Effect.gen(function* () {
  const sql = yield* StoreWriter
  const queuedAt = yield* Clock.currentTimeMillis
  const from = millisToTs(gapStartedAt - ctx.config.recheckLookbackMillis)
  for (const entry of entries) {
    const [previous] = yield* sql<Marker>`SELECT updated, history_invalid FROM conversation_repairs WHERE channel = ${entry.id}`
    const changed = (value: string | undefined, old: string | null) => value !== undefined && value !== old
    if (previous !== undefined && (changed(entry.updated, previous.updated) || changed(entry.history_invalid, previous.history_invalid))) {
      const [member] = yield* sql`SELECT id FROM conversations WHERE id = ${entry.id} AND is_member = 1 AND is_archived = 0`
      if (member !== undefined) {
        // Old roots fetched only for thread metadata cannot extend Main's range. A thread needs cached replies.
        const ranges = yield* sql<{ thread: string; latest: string }>`SELECT
          CASE WHEN thread_ts IS NOT NULL AND thread_ts <> ts AND subtype IS NOT 'thread_broadcast' THEN thread_ts ELSE '' END AS thread,
          max(ts) AS latest FROM messages WHERE channel = ${entry.id} AND deleted = 0 AND partial = 0 AND ts >= ${from}
          GROUP BY thread`
        for (const range of ranges) {
          yield* sql`INSERT INTO repair_pending (channel, thread, oldest, latest, queued_at) VALUES (${entry.id}, ${range.thread}, ${from}, ${range.latest}, ${queuedAt})
            ON CONFLICT (channel, thread) DO UPDATE SET oldest = min(repair_pending.oldest, excluded.oldest), latest = max(repair_pending.latest, excluded.latest),
              queued_at = excluded.queued_at, cursor = NULL, boundary = NULL`
        }
      }
    }
    yield* saveRepairMarkers([entry])
  }
}))

/** An authoritative missing thread ends the job and deletes only its bounded cached replies. */
const missingThread = (ctx: SyncContext, job: Job, requestedAt: Ts) => transaction(Effect.gen(function* () {
  const sql = yield* StoreWriter
  const replies = yield* sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${job.channel}
    AND thread_ts = ${job.thread} AND ts <> ${job.thread} AND deleted = 0 AND ts >= ${job.oldest} AND ts <= ${job.latest}`
  for (const reply of replies) yield* writeDeleted(ctx, job.channel, reply.ts, { kind: 'page', requestedAt })
  yield* sql`DELETE FROM repair_pending WHERE id = ${job.id}`
}))

/** One page only. Presence includes unchanged ids; retention-limited pages never prove absence. */
const repairPage = (ctx: SyncContext, job: Job): Effect.Effect<void, BootError, BootServices> => Effect.gen(function* () {
  const sql = yield* StoreWriter
  if ((yield* Clock.currentTimeMillis) - job.queued_at >= ctx.config.recheckLookbackMillis) {
    yield* sql`DELETE FROM repair_pending WHERE id = ${job.id}`
    return
  }
  const known = yield* sql<{ ts: string; server_version: string | null }>`SELECT m.ts, u.server_version FROM messages m
    LEFT JOIN message_updates u ON u.channel = m.channel AND u.ts = m.ts
    WHERE m.channel = ${job.channel} AND m.deleted = 0 AND m.ts >= ${job.oldest} AND m.ts <= ${job.latest} AND
      (${job.boundary} IS NULL OR CASE WHEN ${job.thread} = '' THEN m.ts < ${job.boundary} ELSE m.ts > ${job.boundary} END) AND
      (CASE WHEN ${job.thread} = '' THEN (m.thread_ts IS NULL OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast')
        ELSE m.thread_ts = ${job.thread} AND m.ts <> ${job.thread} END) ORDER BY m.ts`
  const cached = Object.fromEntries(known.flatMap((m) => m.server_version === null ? [] : [[m.ts, Ts.make(m.server_version)]]))
  const requestedAt = millisToTs(yield* Clock.currentTimeMillis)
  const api = yield* SlackApi
  const args = { channel: job.channel, oldest: job.oldest, latest: job.latest, inclusive: true,
    limit: ctx.config.historyPageLimit, cached_latest_updates: cached, ...(job.cursor === null ? {} : { cursor: job.cursor }) }
  const request = job.thread === ''
    ? api.call('conversations.history', { ...args, ignore_replies: true, no_user_profile: true }, { lane: 'background', reason: 'mutation-repair', singleAttempt: true })
    : api.call('conversations.replies', { ...args, ts: Ts.make(job.thread) }, { lane: 'background', reason: 'mutation-repair', singleAttempt: true })
  const page = yield* request.pipe(Effect.catchTag('SlackRejected', (error) => Effect.gen(function* () {
    if (job.thread === '' || error.error !== 'thread_not_found') return yield* error
    yield* missingThread(ctx, job, requestedAt)
  })))
  if (page === undefined) return
  const topic = job.thread === '' ? mainTopicOf(job.channel) : threadTopicOf(job.channel, job.thread)
  const messages = page.messages.map((m) => ({ ...m, reactions: m.reactions ?? [] }))
  yield* applyPage(ctx, job.channel, messages, { kind: 'page', requestedAt }, { alsoTouch: [topic], latestUpdates: page.latest_updates })
  const present = new Set<string>([...page.messages.map((m) => m.ts), ...(page.unchanged_messages ?? [])])
  const inRange = [...present].filter((ts) => compareTs(ts, job.oldest) >= 0 && compareTs(ts, job.latest) <= 0).sort(compareTs)
  const edge = job.thread === '' ? inRange[0] : inRange.at(-1)
  const next = page.response_metadata?.next_cursor
  // A missing cursor or empty truncated page cannot certify coverage. Keep the job for another catch-up.
  if (page.has_more && (!next || next === job.cursor || edge === undefined)) return
  const lower = job.thread === '' && page.has_more ? edge! : job.oldest
  const upper = job.thread !== '' && page.has_more ? edge! : job.latest
  yield* transaction(Effect.gen(function* () {
    if (!page.is_limited) {
      for (const message of known) {
        if (compareTs(message.ts, lower) >= 0 && compareTs(message.ts, upper) <= 0 && !present.has(message.ts)) {
          yield* writeDeleted(ctx, job.channel, message.ts, { kind: 'page', requestedAt })
        }
      }
    }
    // Keep request bounds stable; exclude earlier pages from the next absence check.
    if (page.has_more) yield* sql`UPDATE repair_pending SET cursor = ${next!}, boundary = ${edge!} WHERE id = ${job.id}`
    else yield* sql`DELETE FROM repair_pending WHERE id = ${job.id}`
  }))
})

/** One request per queued range per pass, at most ten. Failed jobs retain their place for the next pass. */
export const repairMutations = (ctx: SyncContext): Effect.Effect<void, BootError, BootServices> => Effect.gen(function* () {
  yield* awaitEarlierFetches(ctx)
  const sql = yield* StoreWriter
  const jobs = yield* sql<Job>`SELECT * FROM (
    SELECT repair_pending.*, row_number() OVER (PARTITION BY channel ORDER BY id) AS ordinal FROM repair_pending
  ) ORDER BY ordinal, id LIMIT ${REPAIR_CALL_LIMIT}`
  for (const job of jobs) {
    yield* repairPage(ctx, job).pipe(
      Effect.catchTag('SlackRejected', () => Effect.void),
      Effect.catchTag('SlackRateLimited', () => Effect.void),
    )
    // Rotate unfinished ranges behind unattempted work, including refusals and rate limits.
    yield* sql`UPDATE repair_pending SET id = (SELECT max(id) + 1 FROM repair_pending) WHERE id = ${job.id}`
    yield* Effect.yieldNow
  }
})
