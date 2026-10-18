/** Counts select conversations; conditional pages repair their cached Main and thread ranges. */
import { compareTs, millisToTs, Ts, type CountEntry, type Message } from '@juno/slack-schema'
import { SlackApi } from '@juno/slack'
import { StoreWriter, transaction } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { BootError, BootServices } from './boot'
import type { SyncContext } from './context'
import { writeDeleted } from './events'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'

interface Marker { readonly updated: string | null; readonly history_invalid: string | null }

/** Acknowledge only the snapshot that was repaired, never a newer counts response. */
export const saveRepairMarkers = (entries: ReadonlyArray<CountEntry>) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  for (const entry of entries) {
    if (entry.updated === undefined && entry.history_invalid === undefined) continue
    yield* sql`INSERT INTO conversation_repairs (channel, updated, history_invalid)
      VALUES (${entry.id}, ${entry.updated ?? null}, ${entry.history_invalid ?? null})
      ON CONFLICT (channel) DO UPDATE SET
        updated = COALESCE(excluded.updated, conversation_repairs.updated),
        history_invalid = COALESCE(excluded.history_invalid, conversation_repairs.history_invalid)`
  }
})

interface Cached { readonly ts: string; readonly server_version: string | null }
type RepairResult = { readonly kind: 'empty' } | { readonly kind: 'incomplete' } | { readonly kind: 'repaired'; readonly topic: string }

/** A complete bounded range, including unchanged ids in the page's presence set. */
const repairTopic = (ctx: SyncContext, channel: string, thread: string | null): Effect.Effect<RepairResult, BootError, BootServices> => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const known = yield* sql<Cached>`SELECT m.ts, u.server_version FROM messages m
    LEFT JOIN message_updates u ON u.channel = m.channel AND u.ts = m.ts
    WHERE m.channel = ${channel} AND m.deleted = 0 AND
      (CASE WHEN ${thread} IS NULL THEN (m.thread_ts IS NULL OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast')
        ELSE m.thread_ts = ${thread} OR m.ts = ${thread} END)
    ORDER BY m.ts`
  const oldest = known[0]?.ts
  const latest = known.at(-1)?.ts
  if (oldest === undefined || latest === undefined) return { kind: 'empty' as const }
  const cached = Object.fromEntries(known.flatMap((m) => m.server_version === null ? [] : [[m.ts, Ts.make(m.server_version)]]))
  const requestedMillis = yield* Clock.currentTimeMillis
  const requestedAt = millisToTs(requestedMillis)
  const api = yield* SlackApi
  const present = new Set<string>()
  const deleted = new Set<string>()
  const topic = thread === null ? mainTopicOf(channel) : threadTopicOf(channel, thread)
  let cursor: string | undefined
  do {
    const args = { channel, oldest, latest, inclusive: true, limit: ctx.config.historyPageLimit,
      cached_latest_updates: cached, ...(cursor === undefined ? {} : { cursor }) }
    const page = thread === null
      ? yield* api.call('conversations.history', { ...args, ignore_replies: true, no_user_profile: true }, { lane: 'background', reason: 'mutation-repair' })
      : yield* api.call('conversations.replies', { ...args, ts: Ts.make(thread) }, { lane: 'background', reason: 'mutation-repair' })
    const messages: ReadonlyArray<Message> = page.messages.map((m) => {
      const version = page.latest_updates?.[m.ts] ?? m.version
      return { ...m, reactions: m.reactions ?? [], ...(version === undefined ? {} : { version }) }
    })
    for (const m of page.messages) present.add(m.ts)
    for (const ts of page.unchanged_messages ?? []) present.add(ts)
    for (const ts of page.deleted ?? []) deleted.add(ts)
    yield* applyPage(ctx, channel, messages, { kind: 'page', requestedAt }, { alsoTouch: [topic] })
    const next = page.response_metadata?.next_cursor
    if (page.has_more && (!next || next === cursor)) {
      // Never certify a truncated range or infer absence beyond it.
      return { kind: 'incomplete' as const }
    }
    cursor = page.has_more ? next : undefined
    yield* Effect.yieldNow
  } while (cursor !== undefined)
  yield* transaction(Effect.gen(function* () {
    for (const message of known) {
      if (!present.has(message.ts) || deleted.has(message.ts)) yield* writeDeleted(ctx, channel, message.ts, { kind: 'page', requestedAt })
    }
    yield* sql`INSERT INTO rechecked_topics (topic_id, requested_at, from_ts, to_ts) VALUES (${topic}, ${requestedMillis}, ${oldest}, ${latest})
      ON CONFLICT (topic_id) DO UPDATE SET requested_at = excluded.requested_at, from_ts = excluded.from_ts, to_ts = excluded.to_ts`
  }))
  return { kind: 'repaired' as const, topic }
})

export const repairMutations = (ctx: SyncContext, entries: ReadonlyArray<CountEntry>): Effect.Effect<ReadonlySet<string>, BootError, BootServices> => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const repaired = new Set<string>()
  for (const entry of entries) {
    const [previous] = yield* sql<Marker>`SELECT updated, history_invalid FROM conversation_repairs WHERE channel = ${entry.id}`
    const changed = (value: string | undefined, old: string | null | undefined) => value !== undefined && (old == null || compareTs(value, old) > 0)
    if (!changed(entry.updated, previous?.updated) && !changed(entry.history_invalid, previous?.history_invalid)) continue
    const [member] = yield* sql`SELECT id FROM conversations WHERE id = ${entry.id} AND is_member = 1 AND is_archived = 0`
    if (member === undefined) continue
    const threads = yield* sql<{ thread_ts: string }>`SELECT DISTINCT thread_ts FROM messages
      WHERE channel = ${entry.id} AND thread_ts IS NOT NULL AND deleted = 0`
    let complete = true
    for (const thread of [null, ...threads.map((row) => row.thread_ts)]) {
      const result = yield* repairTopic(ctx, entry.id, thread).pipe(
        Effect.catchTag('SlackRejected', () => Effect.succeed({ kind: 'incomplete' as const })),
      )
      if (result.kind === 'incomplete') complete = false
      if (result.kind === 'repaired') repaired.add(result.topic)
    }
    if (complete) yield* transaction(saveRepairMarkers([entry]))
  }
  return repaired
})
