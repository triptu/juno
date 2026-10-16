/**
 * The posts Juno has sent, and the copies the network made of them (ADR
 * 0014, specs/outbox.qnt).
 *
 * Juno sends each post once, but Chromium's network stack sends a request
 * again by itself when a reused connection closes before any answer, and
 * Slack may have run the first one. Slack then holds two messages with the
 * same `client_msg_id`. Every post Juno sends gets a new id, so two
 * messages with one id are never two sends the user meant.
 *
 * - `recordSend` (`posts.ts`) writes a `sent_posts` row in the
 *   transaction that claims the post, before the request leaves. The
 *   agent's sends do the same.
 * - `reconcileSent` runs in `writeMessage`. The first copy Juno stores is
 *   the message; its ts is kept. Another message by the same user with the
 *   same id, in the same channel, is a copy: it is hidden at once and
 *   deleted from Slack through a `delete` row in the outbox
 *   (`queueCopyDelete`).
 * - A copy that shares files is hidden but never deleted: whether
 *   `chat.delete` on it also removes the file the kept message shares is
 *   not known (docs/research). `kept_copies` lists it as hidden.
 * - The copy is deleted only while deleting it loses nothing
 *   (`copyKeepReason`): the kept message is stored and not deleted, and
 *   the copy has no replies, no reactions from others and no edit. This is
 *   checked when the copy is stored, each time it is stored again, and by
 *   the worker in one transaction just before the delete goes out
 *   (`checkCopyDelete`), because the delete can wait in backoff or for the
 *   socket while the user deletes the kept message on another device or
 *   someone replies to the copy. When a check fails the delete is
 *   cancelled, the copy is shown again, and `kept_copies` records why. If
 *   the kept message was deleted on another device, the copy becomes the
 *   message. If the user deleted it in Juno (`deleted_by_user`, or the
 *   delete row still pending), the copy is deleted too.
 * - A post sent before a gap (a socket drop or the app closed) may have
 *   had its kept message deleted during the gap, which no event reports.
 *   Its copy's delete goes out only once the recheck after the gap has read
 *   the copy's own topic over the kept message's ts (`rechecked_topics`).
 *   If the catch-up ends without that, or does not end in time, the copy
 *   is kept: a visible duplicate is better than a lost message.
 *
 * Only ids in `sent_posts`, and only messages by the user who sent them,
 * are reconciled, so Juno never touches a message another client or
 * another person sent.
 */
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Clock, Effect } from 'effect'
import { Invalidation, StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { messageTopics } from './keys'
import { dropAction, queueCopyDelete, type PendingAction } from './actions'

/** `sync_state` key: when the last recheck began (`recheck.ts`). */
export const RECHECK_KEY = 'recheck'

interface SentRow {
  readonly client_msg_id: string
  readonly channel: string
  readonly user_id: string
  readonly ts: string | null
  readonly sent_at: number
  readonly deleted_by_user: 0 | 1
}

/** Why a copy is kept rather than deleted. */
export type KeepReason = 'kept-deleted' | 'replied' | 'reacted' | 'edited' | 'not-rechecked' | typeof FILE_COPY

/** A copy that shares files: hidden, never deleted, until `chat.delete` on it is known not to remove the file. */
export const FILE_COPY = 'file copy kept until verified'

interface KeptRow {
  readonly reason: string
  readonly hidden: 0 | 1
}

const SENT_COLUMNS = 'client_msg_id, channel, user_id, ts, sent_at, deleted_by_user'

const sentPost = (clientMsgId: string): Effect.Effect<SentRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql.unsafe<SentRow>(`SELECT ${SENT_COLUMNS} FROM sent_posts WHERE client_msg_id = ?`, [clientMsgId]))[0]
  })

/** The sent post a stored message is a copy of, or undefined when it is not a copy. */
const copyOf = (row: MessageRow): Effect.Effect<SentRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (row.client_msg_id === null || row.deleted === 1) return undefined
    const sent = yield* sentPost(row.client_msg_id)
    // Another person's message can carry the same id; it is never taken for a copy.
    if (sent === undefined || sent.channel !== row.channel || sent.user_id !== row.user_id || sent.ts === null || sent.ts === row.ts) return undefined
    return sent
  })

/**
 * Whether the user deleted the kept message in Juno: Slack applied it, or
 * the delete row is still pending. Its echo can be stored before the
 * answer, so a pending row counts too.
 */
const deletedByUser = (sent: SentRow): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (sent.deleted_by_user === 1) return true
    const sql = yield* StoreWriter
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM outbox WHERE kind = 'delete' AND target_key = ${sent.channel}
      AND json_extract(payload_json, '$.clientMsgId') = ${sent.client_msg_id}
      AND (json_extract(payload_json, '$.ts') IS NULL OR json_extract(payload_json, '$.ts') = ${sent.ts})`
    return rows[0]!.n > 0
  })

/** Why deleting `copy` would lose something, or undefined when it is safe to delete. */
const copyKeepReason = (copy: MessageRow, sent: SentRow): Effect.Effect<KeepReason | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const kept = (yield* sql<{ deleted: number }>`SELECT deleted FROM messages WHERE channel = ${sent.channel} AND ts = ${sent.ts}`)[0]
    // Deleted on another device, the copy stays as the message; deleted by the user in Juno, the post is meant gone.
    if ((kept === undefined || kept.deleted === 1) && !(yield* deletedByUser(sent))) return 'kept-deleted'
    if (copy.reply_count > 0) return 'replied'
    const others = yield* sql<{ n: number }>`SELECT count(*) AS n FROM reactions WHERE channel = ${copy.channel} AND ts = ${copy.ts} AND count > me`
    if ((others[0]?.n ?? 0) > 0) return 'reacted'
    if (copy.edited_ts !== null) return 'edited'
    return undefined
  })

const keptRow = (row: MessageRow): Effect.Effect<KeptRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<KeptRow>`SELECT reason, hidden FROM kept_copies WHERE channel = ${row.channel} AND ts = ${row.ts}`)[0]
  })

/**
 * Keeps `copy` and records why: shown, or hidden for a file copy. A copy
 * whose kept message is gone becomes the message. The caller drops its
 * delete row.
 */
const keepCopy = (copy: MessageRow, sent: SentRow, reason: KeepReason): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const now = yield* Clock.currentTimeMillis
    const hidden = reason === FILE_COPY ? 1 : 0
    if (reason === 'kept-deleted') yield* sql`UPDATE sent_posts SET ts = ${copy.ts} WHERE client_msg_id = ${sent.client_msg_id}`
    yield* sql`INSERT INTO kept_copies (channel, ts, client_msg_id, reason, hidden, kept_at) VALUES (${copy.channel}, ${copy.ts}, ${sent.client_msg_id}, ${reason}, ${hidden}, ${now})
      ON CONFLICT (channel, ts) DO UPDATE SET reason = excluded.reason, hidden = excluded.hidden`
    yield* Effect.logInfo('send: kept a network copy of a post', { reason })
  })

/** The delete row waiting for `row`, if it is a copy's (it names the copy by ts alone). */
const copyDeleteOf = (row: MessageRow): Effect.Effect<PendingAction | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: number }>`SELECT id FROM outbox WHERE kind = 'delete' AND target_key = ${row.channel} AND depends_on IS NULL
      AND json_extract(payload_json, '$.ts') = ${row.ts} AND json_extract(payload_json, '$.clientMsgId') IS NULL`
    if (rows[0] === undefined) return undefined
    return { id: rows[0].id, kind: 'delete', channel: row.channel, dependsOn: null, payload: { ts: row.ts, clientMsgId: null, topics: messageTopics(row) }, attempts: 0, nextAt: 0, createdAt: 0 }
  })

/** The kept message of a sent post was deleted: a file copy hidden for it is shown and becomes the message. */
const showHiddenCopies = (kept: MessageRow): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const sent = kept.client_msg_id === null ? undefined : yield* sentPost(kept.client_msg_id)
    if (sent === undefined || sent.ts !== kept.ts || sent.channel !== kept.channel || (yield* deletedByUser(sent))) return
    const hidden = yield* sql<MessageRow>`SELECT m.* FROM kept_copies k JOIN messages m ON m.channel = k.channel AND m.ts = k.ts
      WHERE k.client_msg_id = ${sent.client_msg_id} AND k.hidden = 1 AND m.deleted = 0 ORDER BY m.ts LIMIT 1`
    const copy = hidden[0]
    if (copy === undefined) return
    yield* keepCopy(copy, sent, 'kept-deleted')
    yield* Invalidation.use((i) => i.invalidate({ messages: [...messageTopics(copy)] }))
  })

/**
 * A message was stored. If it is one of Juno's sent posts, the first copy
 * keeps its ts, and any other copy is deleted unless deleting it would
 * lose something. A copy that gains a reply while its delete waits has the
 * delete cancelled here. A file copy is hidden, and shown once a reason to
 * keep it appears.
 */
export const reconcileSent = (row: MessageRow): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (row.client_msg_id === null) return
    if (row.deleted === 1) return yield* showHiddenCopies(row)
    const sql = yield* StoreWriter
    const sent = yield* sentPost(row.client_msg_id)
    if (sent !== undefined && sent.ts === null && sent.channel === row.channel && sent.user_id === row.user_id) {
      yield* sql`UPDATE sent_posts SET ts = ${row.ts} WHERE client_msg_id = ${row.client_msg_id}`
      return
    }
    const of = yield* copyOf(row)
    if (of === undefined) return
    const kept = yield* keptRow(row)
    if (kept !== undefined && kept.hidden === 0) return
    const reason = yield* copyKeepReason(row, of)
    if (reason !== undefined) {
      yield* keepCopy(row, of, reason)
      const pending = yield* copyDeleteOf(row)
      if (pending !== undefined) yield* dropAction(pending)
      return
    }
    if (kept !== undefined) return
    if (row.files_json !== null) {
      yield* keepCopy(row, of, FILE_COPY)
      return
    }
    if (yield* queueCopyDelete(row, yield* Clock.currentTimeMillis)) {
      yield* Invalidation.use((i) => i.invalidate(['outbox']))
    }
  })

/** What the worker knows about the gap before a copy's delete. */
export interface CopyGap {
  /** Epoch millis of the last reconnect the worker saw, if any. */
  readonly reconnectedAt: number | undefined
  /** Whether a catch-up has ended since that reconnect. */
  readonly caughtUp: boolean
}

/** Whether a recheck that asked at or after `since` read `topic` over `ts`. */
const rechecked = (topic: string, since: number, ts: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM rechecked_topics
      WHERE topic_id = ${topic} AND requested_at >= ${since} AND from_ts <= ${ts} AND (to_ts IS NULL OR to_ts >= ${ts})`
    return rows[0]!.n > 0
  })

/** The last gap the store may have missed changes in: the later of the worker's reconnect and the last recheck's start. */
const gapEnd = (gap: CopyGap): Effect.Effect<number | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const row = (yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = ${RECHECK_KEY}`)[0]
    const started = row === undefined ? undefined : (JSON.parse(row.value_json) as { startedAt: number }).startedAt
    const ends = [gap.reconnectedAt, started].filter((at): at is number => at !== undefined)
    return ends.length === 0 ? undefined : Math.max(...ends)
  })

/** The topic a recheck reads for a message: its thread for a reply, else Main. */
const recheckTopic = (row: MessageRow): string =>
  row.thread_ts !== null && row.thread_ts !== row.ts && row.subtype !== 'thread_broadcast'
    ? threadTopicId(row.channel as ChannelId, row.thread_ts as Ts)
    : mainTopicId(row.channel as ChannelId)

/**
 * The worker is about to send `action`, a delete of the message at `ts`.
 * Run in a transaction: when it deletes a copy and deleting it would now
 * lose something, or a gap since the post was sent is not covered by a
 * recheck of the copy's topic, the delete is cancelled and the copy shown.
 * Answers whether the call should go out.
 */
export const checkCopyDelete = (action: PendingAction, ts: string, gap: CopyGap): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    // The user's own deletes carry the message's `client_msg_id` or wait on a post; a copy's names it by ts alone.
    if (action.kind !== 'delete' || action.dependsOn !== null || action.payload.clientMsgId !== null) return true
    const sql = yield* StoreWriter
    const copy = (yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${action.channel} AND ts = ${ts}`)[0]
    if (copy === undefined) return true
    const of = yield* copyOf(copy)
    if (of === undefined) return true
    let reason: KeepReason | 'kept' | undefined = (yield* keptRow(copy)) === undefined ? yield* copyKeepReason(copy, of) : 'kept'
    if (reason === undefined) {
      const since = yield* gapEnd(gap)
      if (since !== undefined && of.sent_at <= since && !(gap.caughtUp && (yield* rechecked(recheckTopic(copy), since, of.ts!)))) reason = 'not-rechecked'
    }
    if (reason === undefined) return true
    if (reason !== 'kept') yield* keepCopy(copy, of, reason)
    yield* dropAction(action)
    return false
  })
