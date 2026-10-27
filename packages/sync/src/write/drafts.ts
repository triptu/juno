import { GONE_KEPT, observeSlackDraft, parseTopicId, type DraftOutcome, type DraftState, type SentVersion, type SlackDraft } from '@juno/domain'
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
  /** The row saves again a version taken from Slack (a save was out when it applied), not a local edit. */
  readonly resave?: boolean
  /** The generation Slack refused for good: nothing to send until a newer change. */
  readonly refused?: number
  /** The text of the call out (`''` for a delete), so its echo is known as Juno's own. */
  readonly sending?: string
  /** The call out is a create. */
  readonly creating?: boolean
  /** Texts of calls whose answers were lost, Juno's own until a list requested after `unsureAt`. */
  readonly unsure?: ReadonlyArray<string>
  readonly unsureAt?: number
  /** A create's answer was lost, or Slack said the place has a draft: a list looks for it before another create. */
  readonly findAt?: number
  /**
   * Drafts that went as messages. One the post names (`draft_id`) Slack retires when the post lands, and Juno
   * deletes only if Slack refuses the post; one the post does not name (it went to another place) Juno deletes.
   */
  readonly sent?: ReadonlyArray<SentDraft>
}

/** A Slack draft that went as a message: the post's `client_msg_id`, and whether the post names it. */
export interface SentDraft {
  readonly id: string
  readonly after: string
  readonly named: boolean
}

/** A topic's pending `draft` row. */
export interface PendingDraft {
  readonly topicId: string
  readonly gen: number
  readonly resave: boolean
  readonly refused: number
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
    resave: payload.resave === true,
    refused: payload.refused ?? 0,
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

export const payloadOf = (p: Pick<PendingDraft, 'gen' | 'resave' | 'refused' | 'sending' | 'creating' | 'unsure' | 'unsureAt' | 'findAt' | 'sent'>): string =>
  JSON.stringify({
    gen: p.gen,
    ...(p.resave ? { resave: true } : {}),
    ...(p.refused === 0 ? {} : { refused: p.refused }),
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
    const synced = (yield* sql<{ slack_id: string | null; slack_stamp: string | null; seen_at: string | null; file_ids: string | null; client_msg_id: string | null; gone_ids: string | null; cleared_at: string | null; replaced: string | null; sent_json: string | null; slack_text: string | null }>`
      SELECT slack_id, slack_stamp, seen_at, file_ids, client_msg_id, gone_ids, cleared_at, replaced, sent_json, slack_text FROM draft_sync WHERE topic_id = ${topicId}`)[0]
    const row = yield* pendingDraft(topicId)
    return {
      topicId,
      text: draft?.text ?? '',
      // A draft with no text row was emptied: its time is the clear's.
      editedAt: draft === undefined ? Number(synced?.cleared_at ?? 0) : Number(draft.updated_at),
      ...(synced?.slack_id == null ? {} : { slackId: synced.slack_id }),
      ...(synced?.slack_stamp == null ? {} : { slackStamp: Number(synced.slack_stamp) }),
      ...(synced?.seen_at == null ? {} : { seenAt: Number(synced.seen_at) }),
      ...(synced?.slack_text == null ? {} : { slackText: synced.slack_text }),
      // A row that only saves a version from Slack again is no local edit.
      pending: row !== undefined && !row.resave,
      ...(row?.sending === undefined ? {} : { sending: row.sending }),
      unsure: row?.unsure ?? [],
      gone: synced?.gone_ids == null ? [] : (JSON.parse(synced.gone_ids) as ReadonlyArray<string>),
      sent: synced?.sent_json == null ? [] : (JSON.parse(synced.sent_json) as ReadonlyArray<SentVersion>),
      fileIds: synced?.file_ids == null ? [] : (JSON.parse(synced.file_ids) as ReadonlyArray<string>),
      ...(synced?.client_msg_id == null ? {} : { clientMsgId: synced.client_msg_id }),
      ...(synced?.replaced == null ? {} : { replaced: synced.replaced }),
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

/** The topic that links Slack's draft `slackId`, remembers it gone, or sent it (by id, or by its create's `clientMsgId`). */
export const topicOfSlackDraft = (slackId: string, clientMsgId?: string): Effect.Effect<string | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<{ topic_id: string }>`SELECT topic_id FROM draft_sync WHERE slack_id = ${slackId}
      OR EXISTS (SELECT 1 FROM json_each(COALESCE(gone_ids, '[]')) WHERE value = ${slackId})
      OR EXISTS (SELECT 1 FROM json_each(COALESCE(sent_json, '[]')) WHERE json_extract(value, '$.id') = ${slackId} OR json_extract(value, '$.clientMsgId') = ${clientMsgId ?? ''}) LIMIT 1`)[0]?.topic_id
  })

/** How long, and how many, drafts whose text went as a message are remembered. Slack accepts edit times 30 days old (research section 3). */
const SENT_KEPT_MILLIS = 30 * 86_400_000
const SENT_KEPT = 20

/** The sent drafts still remembered at `now`. */
const keptSent = (sent: ReadonlyArray<SentVersion>, now: number): ReadonlyArray<SentVersion> => sent.filter((each) => each.at > now - SENT_KEPT_MILLIS).slice(-SENT_KEPT)

/** Writes what Juno knows of Slack's draft. */
export const writeSync = (state: DraftSyncRow): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const files = state.fileIds.length === 0 ? null : JSON.stringify(state.fileIds)
    const gone = state.gone.length === 0 ? null : JSON.stringify(state.gone)
    const sent = state.sent.length === 0 ? null : JSON.stringify(state.sent)
    // A text Juno links no draft for is none.
    const slackText = state.slackId === undefined ? null : (state.slackText ?? null)
    yield* sql`INSERT INTO draft_sync (topic_id, slack_id, slack_stamp, seen_at, file_ids, client_msg_id, gone_ids, replaced, sent_json, slack_text)
      VALUES (${state.topicId}, ${state.slackId ?? null}, ${state.slackStamp === undefined ? null : String(state.slackStamp)}, ${state.seenAt === undefined ? null : String(state.seenAt)},
        ${files}, ${state.clientMsgId ?? null}, ${gone}, ${state.replaced ?? null}, ${sent}, ${slackText})
      ON CONFLICT (topic_id) DO UPDATE SET slack_id = excluded.slack_id, slack_stamp = excluded.slack_stamp, seen_at = excluded.seen_at,
        file_ids = excluded.file_ids, client_msg_id = excluded.client_msg_id, gone_ids = excluded.gone_ids, replaced = excluded.replaced, sent_json = excluded.sent_json,
        slack_text = excluded.slack_text`
  })

/** The topic's text at `editedAt`; an empty one deletes the row and keeps the time as the clear's, which its deletion carries. */
const writeText = (topicId: string, text: string, editedAt: number): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if (text.trim() === '') {
      yield* sql`DELETE FROM drafts WHERE topic_id = ${topicId}`
      yield* sql`INSERT INTO draft_sync (topic_id, cleared_at) VALUES (${topicId}, ${String(editedAt)}) ON CONFLICT (topic_id) DO UPDATE SET cleared_at = excluded.cleared_at`
    } else yield* sql`INSERT INTO drafts (topic_id, text, updated_at) VALUES (${topicId}, ${text}, ${String(editedAt)})
      ON CONFLICT (topic_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
  })

export const emptyRow = (topicId: string, now: number): PendingDraft => ({ topicId, gen: 0, resave: false, refused: 0, creating: false, unsure: [], unsureAt: 0, findAt: 0, sent: [], attempts: 0, nextAt: now, createdAt: now })

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
    // Typing again lets the replaced text go.
    if (before.replaced !== undefined) yield* writeSync({ ...(yield* draftSyncRow(topicId)), replaced: undefined })
    yield* draftChanged(topicId, id)
    // Nothing for Slack: a draft cleared before it ever reached Slack.
    if (next === '' && before.slackId === undefined && before.row === undefined) return
    const row = before.row ?? emptyRow(topicId, timing.now)
    yield* writeRow({ ...row, gen: row.gen + 1, resave: false }, Math.min(timing.dueAt, row.createdAt + timing.capMillis))
  })

/**
 * The topic's draft went as a message (`messages.send`), and the draft is cleared. Slack's draft for it is
 * remembered as sent, with Juno's texts that can be on it (the one sent, and those of calls still out or
 * lost), so a version with one of them never brings the text back, whatever the clocks say: the draft Juno
 * links, or, while a create is not answered, the one it may have made, by its `client_msg_id` (the next
 * create gets a new one). A linked draft with no files goes with the post when the post goes where the draft
 * was (`named`: it names the draft as `draft_id`, returned, and Slack retires it); when Slack refuses the post,
 * or the post went elsewhere, Juno deletes it, once it is sure the draft still holds only Juno's text. A draft
 * with files keeps them: Juno empties its text instead.
 */
export const sendDraft = (id: string, clientMsgId: string, now: number, named: boolean): Effect.Effect<string | undefined, SqlError, Services> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const topicId = yield* draftTopicId(sql, id)
    const before = yield* draftSyncRow(topicId)
    yield* writeText(topicId, '', now)
    yield* draftChanged(topicId, id)
    const row = before.row
    const texts = [...new Set([before.text, before.slackText ?? '', ...(row?.sending === undefined ? [] : [row.sending]), ...(row?.unsure ?? [])])].filter((text) => text !== '')
    const unanswered = before.slackId === undefined && before.clientMsgId !== undefined && row !== undefined && (row.creating || row.findAt > 0 || row.unsure.length > 0)
    const version: SentVersion | undefined =
      before.slackId !== undefined ? { id: before.slackId, texts, at: now } : unanswered && before.clientMsgId !== undefined ? { clientMsgId: before.clientMsgId, texts, at: now } : undefined
    const retired = before.slackId !== undefined && before.fileIds.length === 0 ? before.slackId : undefined
    const { slackId, seenAt, clientMsgId: create, ...rest } = yield* draftSyncRow(topicId)
    yield* writeSync({
      ...rest,
      ...(retired === undefined && slackId !== undefined ? { slackId } : {}),
      ...(retired === undefined && seenAt !== undefined ? { seenAt } : {}),
      ...(unanswered || create === undefined ? {} : { clientMsgId: create }),
      // Slack retires a draft the post names: nothing of it can come back.
      gone: named && retired !== undefined ? [...rest.gone, retired].slice(-GONE_KEPT) : rest.gone,
      sent: version === undefined ? rest.sent : keptSent([...rest.sent, version], now),
      replaced: undefined,
    })
    if (retired === undefined && before.slackId === undefined && row === undefined) return undefined
    const base = row ?? emptyRow(topicId, now)
    yield* writeRow({ ...base, gen: base.gen + 1, resave: false, sent: retired === undefined ? base.sent : [...base.sent, { id: retired, after: clientMsgId, named }] }, now)
    return named ? retired : undefined
  })

/**
 * A version of the topic's draft from Slack, applied by `observeSlackDraft`: an event, or an entry of a
 * list requested at `seenAt` (`listed`; it looks for the place's draft while the row's find is open).
 * `same` compares two texts as Slack would store them.
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
    const { state, outcome, save, cleanup } = observeSlackDraft(before, slack, { seenAt: how.seenAt, ...(how.absent === true ? { absent: true } : {}), ...(find ? { find } : {}), same: how.same })
    if (outcome === 'stale') return outcome
    // A deletion of the linked draft takes its files; a live draft keeps or brings them; a sent draft Juno does not link leaves them.
    const fileIds = cleanup === 'delete' ? before.fileIds : slack.deleted && slack.id === before.slackId ? [] : slack.deleted ? before.fileIds : (slack.fileIds ?? before.fileIds)
    // Built from the rule's state, so a link it removed stays removed.
    yield* writeSync({ ...state, topicId, fileIds, ...(before.clientMsgId === undefined ? {} : { clientMsgId: before.clientMsgId }) })
    // A sent draft holding only Juno's text is for Juno to delete; one another device changed is not.
    const current = row === undefined ? undefined : { ...row, sent: cleanup === 'keep' ? row.sent.filter((each) => each.id !== slack.id) : row.sent }
    if (cleanup === 'delete') {
      if (current?.sent.some((each) => each.id === slack.id) === true) return outcome
      // A row only for the delete is no local edit.
      const base = current ?? { ...emptyRow(topicId, how.seenAt), gen: 1, resave: true }
      yield* writeRow({ ...base, sent: [...base.sent, { id: slack.id, after: '', named: false }] }, Math.min(base.nextAt, how.seenAt))
      return outcome
    }
    if (outcome === 'applied') {
      yield* writeText(topicId, state.text, state.editedAt)
      if (current !== undefined) {
        // A save out, or one whose answer was lost, may land after this version: it goes again.
        if (current.sending !== undefined || current.unsure.length > 0 || current.sent.length > 0) yield* writeRow({ ...current, gen: current.gen + 1, resave: true }, 0)
        else yield* dropRow(topicId)
      }
      yield* draftChanged(topicId)
      yield* invalidate(['draft_reviews'])
    } else if (save) {
      // Juno's text goes over Slack's version now.
      const base = current ?? emptyRow(topicId, how.seenAt)
      yield* writeRow({ ...base, gen: row === undefined ? 1 : base.gen }, Math.min(base.nextAt, how.seenAt))
    } else if (cleanup === 'keep' && current !== undefined) yield* writeRow(current, current.nextAt)
    return outcome
  })

/**
 * A complete list requested at `requestedAt` did not have the draft `slackId`. Read again in this
 * transaction: when the topic still links that draft, linked before the request, it counts as deleted just
 * after the version Juno knew; a draft linked since, or another one, is left alone.
 */
export const observeAbsence = (topicId: string, slackId: string, requestedAt: number, same: (a: string, b: string) => boolean): Effect.Effect<DraftOutcome, SqlError, Services> =>
  Effect.gen(function* () {
    const state = yield* draftSyncRow(topicId)
    if (state.slackId !== slackId || (state.seenAt ?? 0) >= requestedAt) return 'stale'
    return yield* observeDraft(topicId, { id: slackId, text: '', stamp: state.slackStamp ?? 0, deleted: true }, { seenAt: requestedAt, absent: true, same })
  })
