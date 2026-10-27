import { GONE_KEPT, observeSlackDraft, parseTopicId, type DraftOutcome, type DraftState, type SlackDraft } from '@juno/domain'
import { Invalidation, StoreWriter, type SqlClient, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { invalidate, type Writer } from './shared'

// Topic drafts synced with Slack (architecture 5.7, specs/drafts.qnt). The rules are `@juno/domain`'s
// `observeSlackDraft`; these functions load and store their state. A topic's draft is its `drafts` row
// (none for no draft); what Juno knows of Slack's draft is its `draft_sync` row; a change Slack has not
// acknowledged is the topic's one `outbox` row of kind `draft`, which the engine's `DraftSync` sends: the
// topic's text as it is when the call goes, so edits in quick succession make one call.

const DRAFT = 'draft'

export type Services = StoreWriter | Invalidation

/** What a pending `draft` row carries. */
interface DraftPayload {
  /** Bumped by every change that replaces the intent, so an answer for an older one does not end the row. */
  readonly gen: number
  /** The text of the call out (`''` for a delete), so its echo is known as Juno's own. */
  readonly sending?: string
  /** The call out is a create. */
  readonly creating?: boolean
  /** Texts of calls whose answers were lost, Juno's own until a list requested after `unsureAt`. */
  readonly unsure?: ReadonlyArray<string>
  readonly unsureAt?: number
  /** A create's answer was lost, or Slack said the place has a draft: a list looks for it before another create. */
  readonly findAt?: number
  /** Drafts that went with a post (`draft_id`). Slack retires each when its post lands; one whose post Slack refused is deleted. */
  readonly sent?: ReadonlyArray<SentDraft>
}

/** A Slack draft that went with a post, and the post's `client_msg_id`. */
export interface SentDraft {
  readonly id: string
  readonly after: string
}

/** A topic's pending `draft` row. */
export interface PendingDraft {
  readonly topicId: string
  readonly gen: number
  readonly sending?: string
  readonly creating: boolean
  readonly unsure: ReadonlyArray<string>
  readonly unsureAt: number
  readonly findAt: number
  readonly sent: ReadonlyArray<SentDraft>
  readonly attempts: number
  /** Epoch milliseconds when the sender may send it. */
  readonly nextAt: number
  /** Epoch milliseconds when the row was written: a pause in typing holds a save no longer than a cap after it. */
  readonly createdAt: number
}

/** A topic's draft, what Juno knows of Slack's, and its pending row, as the rules and the sender read them. */
export interface DraftSyncRow extends DraftState {
  readonly topicId: string
  /** Slack's files on the draft, kept on every update. Juno does not show or change them. */
  readonly fileIds: ReadonlyArray<string>
  /** The `client_msg_id` Juno creates the place's draft with. */
  readonly clientMsgId?: string
  readonly row?: PendingDraft
}

interface Row {
  readonly target_key: string
  readonly payload_json: string
  readonly attempts: number
  readonly next_at: string | null
  readonly created_at: string
}

export const toPending = (row: Row): PendingDraft => {
  const payload = JSON.parse(row.payload_json) as DraftPayload
  return {
    topicId: row.target_key,
    gen: payload.gen,
    ...(payload.sending === undefined ? {} : { sending: payload.sending }),
    creating: payload.creating === true,
    unsure: payload.unsure ?? [],
    unsureAt: payload.unsureAt ?? 0,
    findAt: payload.findAt ?? 0,
    sent: payload.sent ?? [],
    attempts: row.attempts,
    nextAt: row.next_at === null ? 0 : Number(row.next_at),
    createdAt: Number(row.created_at),
  }
}

export const payloadOf = (p: Pick<PendingDraft, 'gen' | 'sending' | 'creating' | 'unsure' | 'unsureAt' | 'findAt' | 'sent'>): string =>
  JSON.stringify({
    gen: p.gen,
    ...(p.sending === undefined ? {} : { sending: p.sending }),
    ...(p.creating ? { creating: true } : {}),
    ...(p.unsure.length === 0 ? {} : { unsure: p.unsure, unsureAt: p.unsureAt }),
    ...(p.findAt === 0 ? {} : { findAt: p.findAt }),
    ...(p.sent.length === 0 ? {} : { sent: p.sent }),
  } satisfies DraftPayload)

/**
 * The topic a draft is kept under: a thread Juno started keeps the id it had before Slack gave its root a
 * ts (`started_threads`), so the draft written then stays with it.
 */
export const draftTopicId = (sql: SqlClient.SqlClient, id: string) =>
  Effect.gen(function* () {
    const topic = parseTopicId(id)
    if (topic?.kind !== 'thread') return id
    const row = (yield* sql<{ topic_id: string }>`SELECT topic_id FROM started_threads WHERE channel = ${topic.channel} AND root_ts = ${topic.threadTs}`)[0]
    return row?.topic_id ?? id
  })

/** Where the topic's draft goes in Slack: its conversation, and its thread for a thread. `undefined` for a thread whose root Slack has not posted yet. */
export const draftDestination = (topicId: string): Effect.Effect<{ readonly channel: string; readonly threadTs?: string } | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const parsed = parseTopicId(topicId)
    if (parsed?.kind === 'main') return { channel: parsed.channel }
    if (parsed?.kind === 'thread') return { channel: parsed.channel, threadTs: parsed.threadTs }
    if (!topicId.startsWith('p:')) return undefined
    const sql = yield* StoreWriter
    const row = (yield* sql<{ channel: string; root_ts: string | null }>`SELECT channel, root_ts FROM started_threads WHERE topic_id = ${topicId}`)[0]
    return row?.root_ts == null ? undefined : { channel: row.channel, threadTs: row.root_ts }
  })

/** The keys a change to the topic's draft fires: every id the composer may read it under, and Home's old drafts. */
const draftChanged = (topicId: string, alsoId?: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const root = topicId.startsWith('p:')
      ? (yield* sql<{ channel: string; root_ts: string | null }>`SELECT channel, root_ts FROM started_threads WHERE topic_id = ${topicId}`)[0]
      : undefined
    const ids = new Set([topicId, ...(alsoId === undefined ? [] : [alsoId]), ...(root?.root_ts == null ? [] : [`t:${root.channel}:${root.root_ts}`])])
    yield* invalidate({ drafts: [...ids] })
  })

/** Every pending `draft` row, the earliest due first. */
export const pendingDrafts: Effect.Effect<ReadonlyArray<PendingDraft>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<Row>`SELECT target_key, payload_json, attempts, next_at, created_at FROM outbox WHERE kind = ${DRAFT} ORDER BY CAST(next_at AS INTEGER), id`
  return rows.map(toPending)
})

export const pendingDraft = (topicId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<Row>`SELECT target_key, payload_json, attempts, next_at, created_at FROM outbox WHERE kind = ${DRAFT} AND target_key = ${topicId}`
    return rows[0] === undefined ? undefined : toPending(rows[0])
  })

/** The topic's draft, what Juno knows of Slack's, and its pending row. */
export const draftSyncRow = (topicId: string): Effect.Effect<DraftSyncRow, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const draft = (yield* sql<{ text: string; updated_at: string }>`SELECT text, updated_at FROM drafts WHERE topic_id = ${topicId}`)[0]
    const synced = (yield* sql<{ slack_id: string | null; slack_stamp: string | null; seen_at: string | null; file_ids: string | null; client_msg_id: string | null; gone_ids: string | null }>`
      SELECT slack_id, slack_stamp, seen_at, file_ids, client_msg_id, gone_ids FROM draft_sync WHERE topic_id = ${topicId}`)[0]
    const row = yield* pendingDraft(topicId)
    return {
      topicId,
      text: draft?.text ?? '',
      editedAt: draft === undefined ? 0 : Number(draft.updated_at),
      ...(synced?.slack_id == null ? {} : { slackId: synced.slack_id }),
      ...(synced?.slack_stamp == null ? {} : { slackStamp: Number(synced.slack_stamp) }),
      ...(synced?.seen_at == null ? {} : { seenAt: Number(synced.seen_at) }),
      pending: row !== undefined,
      ...(row?.sending === undefined ? {} : { sending: row.sending }),
      unsure: row?.unsure ?? [],
      gone: synced?.gone_ids == null ? [] : (JSON.parse(synced.gone_ids) as ReadonlyArray<string>),
      fileIds: synced?.file_ids == null ? [] : (JSON.parse(synced.file_ids) as ReadonlyArray<string>),
      ...(synced?.client_msg_id == null ? {} : { clientMsgId: synced.client_msg_id }),
      ...(row === undefined ? {} : { row }),
    }
  })

/** Every topic with a linked Slack draft, with the link and when it was made. */
export const linkedDrafts: Effect.Effect<ReadonlyArray<{ readonly topicId: string; readonly slackId: string; readonly seenAt: number }>, SqlError, StoreWriter> =
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ topic_id: string; slack_id: string; seen_at: string | null }>`SELECT topic_id, slack_id, seen_at FROM draft_sync WHERE slack_id IS NOT NULL`
    return rows.map((row) => ({ topicId: row.topic_id, slackId: row.slack_id, seenAt: Number(row.seen_at ?? 0) }))
  })

/** The topic that links Slack's draft `slackId`, or remembers it gone. */
export const topicOfSlackDraft = (slackId: string): Effect.Effect<string | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<{ topic_id: string }>`SELECT topic_id FROM draft_sync WHERE slack_id = ${slackId}
      OR EXISTS (SELECT 1 FROM json_each(COALESCE(gone_ids, '[]')) WHERE value = ${slackId}) LIMIT 1`)[0]?.topic_id
  })

/** Writes what Juno knows of Slack's draft. */
export const writeSync = (state: DraftSyncRow): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const files = state.fileIds.length === 0 ? null : JSON.stringify(state.fileIds)
    const gone = state.gone.length === 0 ? null : JSON.stringify(state.gone)
    yield* sql`INSERT INTO draft_sync (topic_id, slack_id, slack_stamp, seen_at, file_ids, client_msg_id, gone_ids)
      VALUES (${state.topicId}, ${state.slackId ?? null}, ${state.slackStamp === undefined ? null : String(state.slackStamp)}, ${state.seenAt === undefined ? null : String(state.seenAt)},
        ${files}, ${state.clientMsgId ?? null}, ${gone})
      ON CONFLICT (topic_id) DO UPDATE SET slack_id = excluded.slack_id, slack_stamp = excluded.slack_stamp, seen_at = excluded.seen_at,
        file_ids = excluded.file_ids, client_msg_id = excluded.client_msg_id, gone_ids = excluded.gone_ids`
  })

const writeText = (topicId: string, text: string, editedAt: number): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if (text.trim() === '') yield* sql`DELETE FROM drafts WHERE topic_id = ${topicId}`
    else yield* sql`INSERT INTO drafts (topic_id, text, updated_at) VALUES (${topicId}, ${text}, ${String(editedAt)})
      ON CONFLICT (topic_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
  })

export const emptyRow = (topicId: string, now: number): PendingDraft => ({ topicId, gen: 0, creating: false, unsure: [], unsureAt: 0, findAt: 0, sent: [], attempts: 0, nextAt: now, createdAt: now })

/** Writes the pending row as given, or adds it, due at `dueAt`. */
export const writeRow = (row: PendingDraft, dueAt: number): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const existing = yield* pendingDraft(row.topicId)
    if (existing === undefined) {
      yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at, next_at)
        VALUES (${DRAFT}, ${row.topicId}, ${payloadOf(row)}, ${String(row.createdAt)}, ${String(dueAt)})`
    } else {
      yield* sql`UPDATE outbox SET payload_json = ${payloadOf(row)}, next_at = ${String(dueAt)} WHERE kind = ${DRAFT} AND target_key = ${row.topicId}`
    }
  })

export const dropRow = (topicId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM outbox WHERE kind = ${DRAFT} AND target_key = ${topicId}`
  })

/**
 * A local change to the topic's draft at `now` (Juno's clock): the composer's text after a pause in typing
 * (`dueAt` a pause later, held no longer than `capMillis` after the row was written), or at once (`dueAt` =
 * `now`) when the field lost focus or a review deleted or restored it. An unchanged text only brings a
 * waiting save forward. A blank text deletes the draft, and Slack's with it. `editedAt` is the edit's
 * time: `now`, or the time a restored draft had.
 */
export const writeLocalDraft = (id: string, text: string, timing: { readonly now: number; readonly dueAt: number; readonly capMillis: number }, editedAt = timing.now): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const topicId = yield* draftTopicId(sql, id)
    const before = yield* draftSyncRow(topicId)
    const next = text.trim() === '' ? '' : text
    if (next === before.text) {
      if (before.row !== undefined && before.row.nextAt > timing.dueAt) yield* sql`UPDATE outbox SET next_at = ${String(timing.dueAt)} WHERE kind = ${DRAFT} AND target_key = ${topicId}`
      return
    }
    yield* writeText(topicId, next, editedAt)
    yield* draftChanged(topicId, id)
    // Nothing for Slack: a draft cleared before it ever reached Slack.
    if (next === '' && before.slackId === undefined && before.row === undefined) return
    const row = before.row ?? emptyRow(topicId, timing.now)
    yield* writeRow({ ...row, gen: row.gen + 1 }, Math.min(timing.dueAt, row.createdAt + timing.capMillis))
  })

/**
 * The topic's draft went as a message (`messages.send`). The draft is cleared. Slack's draft for it, if Juno
 * links one with no files, is returned: the post names it (`draft_id`) and Slack retires it; it is gone for
 * Juno from now on, and deleted only if Slack refuses the post. A draft with files keeps them: Juno empties
 * its text instead.
 */
export const sendDraft = (id: string, clientMsgId: string, now: number): Effect.Effect<string | undefined, SqlError, Services> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const topicId = yield* draftTopicId(sql, id)
    const before = yield* draftSyncRow(topicId)
    yield* writeText(topicId, '', now)
    yield* draftChanged(topicId, id)
    const named = before.slackId !== undefined && before.fileIds.length === 0 ? before.slackId : undefined
    if (named !== undefined) {
      const { slackId: _, seenAt: _seen, ...rest } = before
      yield* writeSync({ ...rest, gone: [...before.gone, named].slice(-GONE_KEPT) })
    }
    if (named === undefined && before.slackId === undefined && before.row === undefined) return undefined
    const row = before.row ?? emptyRow(topicId, now)
    yield* writeRow({ ...row, gen: row.gen + 1, sent: named === undefined ? row.sent : [...row.sent, { id: named, after: clientMsgId }] }, now)
    return named
  })

/**
 * A version of the topic's draft from Slack, applied by `observeSlackDraft`: an event, or an entry of a
 * list requested at `seenAt` (`absent` for a complete list without the linked draft; `find` while the
 * row looks for the place's draft). `same` compares two texts as Slack would store them.
 */
export const observeDraft = (
  topicId: string,
  slack: SlackDraft & { readonly fileIds?: ReadonlyArray<string> },
  how: { readonly seenAt: number; readonly absent?: boolean; readonly listed?: boolean; readonly same: (a: string, b: string) => boolean },
): Effect.Effect<DraftOutcome, SqlError, Services> =>
  Effect.gen(function* () {
    const before = yield* draftSyncRow(topicId)
    const row = before.row
    const find = how.listed === true && row !== undefined && row.findAt > 0 && how.seenAt > row.findAt && before.slackId === undefined
    const { state, outcome, save } = observeSlackDraft(before, slack, { seenAt: how.seenAt, ...(how.absent === true ? { absent: true } : {}), ...(find ? { find } : {}), same: how.same })
    if (outcome === 'stale') return outcome
    const fileIds = slack.text === '' ? [] : (slack.fileIds ?? before.fileIds)
    yield* writeSync({ ...before, ...state, fileIds, ...(before.clientMsgId === undefined ? {} : { clientMsgId: before.clientMsgId }) })
    if (outcome === 'applied') {
      yield* writeText(topicId, state.text, state.editedAt)
      if (row !== undefined) {
        // A save out, or one whose answer was lost, may land after this version: it goes again.
        if (row.sending !== undefined || row.unsure.length > 0 || row.sent.length > 0) yield* writeRow({ ...row, gen: row.gen + 1 }, 0)
        else yield* dropRow(topicId)
      }
      yield* draftChanged(topicId)
      yield* invalidate(['draft_reviews'])
    } else if (save) {
      // Juno's text goes over Slack's version now.
      const current = row ?? emptyRow(topicId, how.seenAt)
      yield* writeRow({ ...current, gen: row === undefined ? 1 : current.gen }, Math.min(current.nextAt, how.seenAt))
    }
    return outcome
  })
