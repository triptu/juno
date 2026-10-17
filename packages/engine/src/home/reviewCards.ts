/**
 * What two of Home's review cards read (`docs/design/settled-suggestions/`,
 * "More self-management"): follow-ups that look done, from each promise's
 * later messages (`followUpDelivery`), and old drafts (`isOldDraft`). The
 * Home query (`query.ts`) passes in its own readers of topics and messages.
 */
import type { FollowUpMatch, HomeTopic, OldDraft } from '@juno/contract'
import { draftFirstLine, followUpDelivery, isOldDraft, messagePreviewText, millisToTs, OLD_DRAFT_MILLIS, tsToMillis, type PreviewMessage, type Ts } from '@juno/domain'
import { StoreReader, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { HomeRow, MessageRow } from './query'

type SlackFile = NonNullable<PreviewMessage['files']>[number]
type ReadAfter = (row: HomeRow, after: string, limit: number) => Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreReader>

/** Messages read after a promise, and the most promises proposed. */
const DELIVERY_MESSAGES = 50
const DONE_SHOWN = 20
/** Drafts looked at, oldest change first, and the most proposed. */
const DRAFTS_READ = 40
const DRAFTS_SHOWN = 20
/** The messages since an old draft that its row counts; more reads "50+". */
const DRAFT_SINCE_MAX = 50

/** A message's files, from its stored JSON. */
const filesOf = (json: string | null): ReadonlyArray<SlackFile> => {
  if (json === null) return []
  try {
    const files = JSON.parse(json) as unknown
    return Array.isArray(files) ? (files as ReadonlyArray<SlackFile>) : []
  } catch {
    return []
  }
}

/** A promise and the later message of the user's that matches it. */
export interface Delivered {
  readonly promiseTs: string
  readonly promise: string
  readonly kind: FollowUpMatch['kind']
  readonly message: MessageRow
}

/** A `follow_ups` row not marked done. */
export interface OpenPromise {
  readonly topic_id: string
  readonly message_ts: string
  readonly text: string
  readonly match_kept_ts: string | null
}

/** Follow-ups that look done, by topic id: each topic's newest promise with a match, at most `DONE_SHOWN`. */
export const readDelivered = (
  promises: ReadonlyArray<OpenPromise>,
  rows: ReadonlyArray<HomeRow>,
  selfId: string,
  readAfter: ReadAfter,
): Effect.Effect<Map<string, Delivered>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const delivered = new Map<string, Delivered>()
    for (const promise of promises) {
      if (delivered.size >= DONE_SHOWN || delivered.has(promise.topic_id)) continue
      const row = rows.find((r) => r.topic_id === promise.topic_id)
      if (row === undefined || row.last_activity_ts === null || row.last_activity_ts <= promise.message_ts) continue
      const later = yield* readAfter(row, promise.message_ts, DELIVERY_MESSAGES)
      const match = followUpDelivery(
        promise.message_ts,
        later.map((m) => ({ ts: m.ts, user_id: m.user_id, text: m.text, files: filesOf(m.files_json).length })),
        selfId,
        promise.match_kept_ts ?? undefined,
      )
      const message = match === undefined ? undefined : later.find((m) => m.ts === match.ts)
      if (match !== undefined && message !== undefined) delivered.set(promise.topic_id, { promiseTs: promise.message_ts, promise: promise.text, kind: match.kind, message })
    }
    return delivered
  })

/** Old drafts: the open topics they are in, oldest draft first, and each draft as its row shows it. */
export const readOldDrafts = (
  now: number,
  topics: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<HomeRow>, SqlError, StoreReader>,
  readAfter: ReadAfter,
): Effect.Effect<{ readonly rows: ReadonlyArray<HomeRow>; readonly drafts: ReadonlyMap<string, OldDraft> }, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const stored = yield* sql<{ topic_id: string; text: string; updated_at: string; kept_at: string | null }>`
      SELECT topic_id, text, updated_at, kept_at FROM drafts WHERE CAST(updated_at AS INTEGER) <= ${now - OLD_DRAFT_MILLIS}
      ORDER BY CAST(updated_at AS INTEGER) LIMIT ${DRAFTS_READ}`
    const open = stored.length === 0 ? [] : yield* topics(stored.map((draft) => draft.topic_id))
    const drafts = new Map<string, OldDraft>()
    const rows: Array<HomeRow> = []
    for (const draft of stored) {
      if (rows.length >= DRAFTS_SHOWN) break
      const row = open.find((r) => r.topic_id === draft.topic_id)
      const updatedAt = Number(draft.updated_at)
      const text = draftFirstLine(draft.text)
      if (row === undefined || text === '') continue
      const activity = row.last_activity_ts === null ? undefined : tsToMillis(row.last_activity_ts as Ts)
      if (!isOldDraft({ updatedAt, ...(draft.kept_at === null ? {} : { keptAt: Number(draft.kept_at) }) }, activity, now)) continue
      const since = (yield* readAfter(row, millisToTs(updatedAt), DRAFT_SINCE_MAX + 1)).filter((m) => m.user_id !== null).length
      drafts.set(row.topic_id, { text, at: updatedAt, since: Math.min(since, DRAFT_SINCE_MAX), ...(since > DRAFT_SINCE_MAX ? { more: true as const } : {}) })
      rows.push(row)
    }
    return { rows, drafts }
  })

/** A topic of the card, with its promise and the matching message as a one-line preview. */
export function withDelivery(topic: HomeTopic, match: Delivered | undefined, lookups: Parameters<typeof messagePreviewText>[1]): HomeTopic {
  if (match === undefined) return topic
  const files = filesOf(match.message.files_json)
  const text = messagePreviewText({ text: match.message.text, ...(files.length === 0 ? {} : { files }) }, lookups)
  return { ...topic, at: tsToMillis(match.promiseTs as Ts), followUp: { promiseTs: match.promiseTs, promise: match.promise, ts: match.message.ts, kind: match.kind, text } }
}
