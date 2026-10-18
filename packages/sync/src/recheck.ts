/**
 * After mutation-marker repair, the bounded fallback (architecture 5.8,
 * specs/catchup.qnt): edits, deletes and
 * reaction changes made while the socket was down or the app was closed
 * reach Juno through no event, and they do not move a conversation's
 * `latest`, so history since the synced range never sees them. After a
 * reconnect or a warm boot the catch-up reads the recent messages of the
 * topics most likely to have changed again: the topics on screen first,
 * then the most recently active member topics, at most `recheckTopics`,
 * each one page back to `recheckLookbackMillis` before the gap began.
 *
 * The page merges by the usual rules, with two additions:
 *
 * - A message on the page without `reactions` has none (Slack leaves the
 *   field out when it is empty), so a reaction removed during the gap goes.
 * - A message the store held when the page was requested, inside the span
 *   the page covers, that the page lacks was deleted. A message stored
 *   after the request (its event raced the page) is never inferred deleted.
 *   A thread page does not infer its root: the root is Main's, and Main's
 *   page covers it.
 *
 * Each recheck records when it began (`sync_state` `recheck`), and each
 * topic the span its page covered (`rechecked_topics`), after the
 * deletions it found are stored. A network copy's delete that waited
 * across the gap goes out only if its own topic is covered (ADR 0014).
 */
import { millisToTs, parseTopicId, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { compareTs, type Message } from '@juno/slack-schema'
import { StoreWriter, transaction } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { BootError, BootServices } from './boot'
import { awaitEarlierFetches, type SyncContext } from './context'
import { writeDeleted } from './events'
import { RECHECK_KEY } from './sent'
import { setSyncState } from './write'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'

export interface RecheckOptions {
  /** Epoch millis when the gap began: the socket drop, or the last moment the store was in step. */
  readonly since: number
  /** Topics to read first, such as the ones on screen. */
  readonly first: ReadonlyArray<string>
}

type Target = { readonly kind: 'main'; readonly channel: string } | { readonly kind: 'thread'; readonly channel: string; readonly threadTs: string }

/** The topics to read again, at most `recheckTopics`: `first`, then the member topics active since `from`, newest first. */
const targets = (ctx: SyncContext, first: ReadonlyArray<string>, from: Ts): Effect.Effect<ReadonlyArray<Target>, BootError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const limit = ctx.config.recheckTopics
    const active = yield* sql<{ topic_id: string }>`
      SELECT i.topic_id FROM topic_index i JOIN conversations c ON c.id = i.channel
        WHERE c.is_member = 1 AND c.is_archived = 0 AND i.kind IN ('main', 'thread') AND i.last_activity_ts >= ${from}
        ORDER BY i.last_activity_ts DESC LIMIT ${limit}`
    const ids = [...new Set([...first, ...active.map((row) => row.topic_id)])]
    const out: Array<Target> = []
    for (const id of ids) {
      const parsed = parseTopicId(id)
      if (parsed === undefined) continue
      out.push(parsed.kind === 'main' ? { kind: 'main', channel: parsed.channel } : { kind: 'thread', channel: parsed.channel, threadTs: parsed.threadTs })
      if (out.length >= limit) break
    }
    return out
  })

/** The live messages of the target the store holds from `from` on. A thread's root is left out. */
const storedSince = (target: Target, from: Ts): Effect.Effect<ReadonlyArray<string>, BootError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows =
      target.kind === 'main'
        ? yield* sql<{ ts: string }>`
            SELECT ts FROM messages WHERE channel = ${target.channel} AND deleted = 0 AND ts >= ${from}
              AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')`
        : yield* sql<{ ts: string }>`
            SELECT ts FROM messages WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs} AND ts <> ${target.threadTs}
              AND deleted = 0 AND ts >= ${from}`
    return rows.map((row) => row.ts)
  })

/** One target: its page, merged, then the deletions it shows. */
const recheckOne = (ctx: SyncContext, target: Target, from: Ts): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const known = yield* storedSince(target, from)
    const requestedMillis = yield* Clock.currentTimeMillis
    const requestedAt = millisToTs(requestedMillis)
    const limit = ctx.config.historyPageLimit
    const page =
      target.kind === 'main'
        ? yield* api.call(
            'conversations.history',
            { channel: target.channel, oldest: from, inclusive: true, limit, ignore_replies: true, no_user_profile: true },
            { lane: 'background', reason: 'recheck' },
          )
        : yield* api.call(
            'conversations.replies',
            { channel: target.channel, ts: target.threadTs as Ts, oldest: from, inclusive: true, limit },
            { lane: 'background', reason: 'recheck' },
          )
    const messages: ReadonlyArray<Message> = page.messages.map((message) => (message.reactions === undefined ? { ...message, reactions: [] } : message))
    const topic = target.kind === 'main' ? mainTopicOf(target.channel) : threadTopicOf(target.channel, target.threadTs)
    yield* applyPage(ctx, target.channel, messages, { kind: 'page', requestedAt }, { alsoTouch: [topic] })

    // The span the page covers: history pages run newest first, so more history is older; replies run oldest first.
    const edge = page.messages.at(-1)?.ts
    const inSpan = (ts: string) => !page.has_more || edge === undefined || (target.kind === 'main' ? compareTs(ts, edge) >= 0 : compareTs(ts, edge) <= 0)
    const present = new Set<string>(page.messages.map((message) => message.ts))
    const gone = known.filter((ts) => !page.is_limited && inSpan(ts) && !present.has(ts))
    const sql = yield* StoreWriter
    const fromTs = target.kind === 'main' && page.has_more && edge !== undefined ? edge : from
    const toTs = target.kind === 'thread' && page.has_more && edge !== undefined ? edge : null
    yield* transaction(
      Effect.gen(function* () {
        yield* Effect.forEach(gone, (ts) => writeDeleted(ctx, target.channel, ts, { kind: 'page', requestedAt }), { discard: true })
        yield* sql`INSERT INTO rechecked_topics (topic_id, requested_at, from_ts, to_ts) VALUES (${topic}, ${requestedMillis}, ${fromTs}, ${toTs})
          ON CONFLICT (topic_id) DO UPDATE SET requested_at = excluded.requested_at, from_ts = excluded.from_ts, to_ts = excluded.to_ts`
      }),
    )
  })

/**
 * Reads the likely topics again after a gap (module comment). A topic Slack
 * refuses is skipped. It first waits for the opened topics' and roots'
 * fetches requested before it, whose older answers could otherwise land
 * after its own and bring back a message it found gone.
 */
export const recheck = (ctx: SyncContext, options: RecheckOptions): Effect.Effect<void, BootError, BootServices> =>
  Effect.gen(function* () {
    yield* awaitEarlierFetches(ctx)
    yield* transaction(setSyncState(RECHECK_KEY, { startedAt: yield* Clock.currentTimeMillis }))
    const from = millisToTs(options.since - ctx.config.recheckLookbackMillis)
    for (const target of yield* targets(ctx, options.first, from)) {
      yield* recheckOne(ctx, target, from).pipe(
        Effect.catchTag('SlackRejected', (error) => Effect.logWarning('sync: recheck refused, skipped', { reason: error.error })),
      )
      yield* Effect.yieldNow
    }
  })
