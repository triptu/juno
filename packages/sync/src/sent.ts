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
 *   same id, in the same channel, is a copy: it is hidden at once and deleted from Slack through a `delete`
 *   row in the outbox (`queueCopyDelete`).
 * - The copy is deleted only while deleting it loses nothing
 *   (`copyKeepReason`): the kept message is stored and not deleted, and
 *   the copy has no replies, no reactions from others and no edit. This is
 *   checked when the copy is stored, each time it is stored again, and by
 *   the worker in one transaction just before the delete goes out
 *   (`checkCopyDelete`), because the delete can wait in backoff or for the
 *   socket while the user deletes the kept message on another device or
 *   someone replies to the copy. When a check fails the delete is
 *   cancelled, the copy is shown again, and `kept_copies` records why. If
 *   the kept message was deleted, the copy becomes the message.
 *
 * Only ids in `sent_posts`, and only messages by the user who sent them,
 * are reconciled, so Juno never touches a message another client or
 * another person sent.
 */
import { Clock, Effect } from 'effect'
import { Invalidation, StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { messageTopics } from './keys'
import { dropAction, queueCopyDelete, type PendingAction } from './actions'

interface SentRow {
  readonly client_msg_id: string
  readonly channel: string
  readonly user_id: string
  readonly ts: string | null
}

/** Why a copy is kept rather than deleted. */
export type KeepReason = 'kept-deleted' | 'replied' | 'reacted' | 'edited'

/** The sent post a stored message is a copy of, or undefined when it is not a copy. */
const copyOf = (row: MessageRow): Effect.Effect<SentRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (row.client_msg_id === null || row.deleted === 1) return undefined
    const sql = yield* StoreWriter
    const sent = (yield* sql<SentRow>`SELECT client_msg_id, channel, user_id, ts FROM sent_posts WHERE client_msg_id = ${row.client_msg_id}`)[0]
    // Another person's message can carry the same id; it is never taken for a copy.
    if (sent === undefined || sent.channel !== row.channel || sent.user_id !== row.user_id || sent.ts === null || sent.ts === row.ts) return undefined
    return sent
  })

/** Why deleting `copy` would lose something, or undefined when it is safe to delete. */
const copyKeepReason = (copy: MessageRow, sent: SentRow): Effect.Effect<KeepReason | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const kept = (yield* sql<{ deleted: number }>`SELECT deleted FROM messages WHERE channel = ${sent.channel} AND ts = ${sent.ts}`)[0]
    if (kept === undefined || kept.deleted === 1) return 'kept-deleted'
    if (copy.reply_count > 0) return 'replied'
    const others = yield* sql<{ n: number }>`SELECT count(*) AS n FROM reactions WHERE channel = ${copy.channel} AND ts = ${copy.ts} AND count > me`
    if ((others[0]?.n ?? 0) > 0) return 'reacted'
    if (copy.edited_ts !== null) return 'edited'
    return undefined
  })

/** Keeps `copy`: records why, and makes it the message when the kept one is gone. The caller drops its delete row. */
const keepCopy = (copy: MessageRow, sent: SentRow, reason: KeepReason): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const now = yield* Clock.currentTimeMillis
    if (reason === 'kept-deleted') yield* sql`UPDATE sent_posts SET ts = ${copy.ts} WHERE client_msg_id = ${sent.client_msg_id}`
    yield* sql`INSERT INTO kept_copies (channel, ts, client_msg_id, reason, kept_at) VALUES (${copy.channel}, ${copy.ts}, ${sent.client_msg_id}, ${reason}, ${now})
      ON CONFLICT (channel, ts) DO NOTHING`
    yield* Effect.logInfo('send: kept a network copy of a post', { reason })
  })

const isKept = (row: MessageRow): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<{ n: number }>`SELECT count(*) AS n FROM kept_copies WHERE channel = ${row.channel} AND ts = ${row.ts}`)[0]!.n > 0
  })

/** The delete row waiting for `row`, if it is a copy's (it names the copy by ts alone). */
const copyDeleteOf = (row: MessageRow): Effect.Effect<PendingAction | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: number }>`SELECT id FROM outbox WHERE kind = 'delete' AND target_key = ${row.channel} AND depends_on IS NULL
      AND json_extract(payload_json, '$.ts') = ${row.ts} AND json_extract(payload_json, '$.clientMsgId') IS NULL`
    if (rows[0] === undefined) return undefined
    return { id: rows[0].id, kind: 'delete', channel: row.channel, dependsOn: null, payload: { ts: row.ts, clientMsgId: null, topics: [] }, attempts: 0, nextAt: 0 }
  })

/**
 * A message was stored. If it is one of Juno's sent posts, the first copy
 * keeps its ts, and any other copy is deleted unless deleting it would
 * lose something. A copy that gains a reply while its delete waits has the
 * delete cancelled here.
 */
export const reconcileSent = (row: MessageRow): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (row.client_msg_id === null || row.deleted === 1) return
    const sql = yield* StoreWriter
    const sent = (yield* sql<SentRow>`SELECT client_msg_id, channel, user_id, ts FROM sent_posts WHERE client_msg_id = ${row.client_msg_id}`)[0]
    if (sent !== undefined && sent.ts === null && sent.channel === row.channel && sent.user_id === row.user_id) {
      yield* sql`UPDATE sent_posts SET ts = ${row.ts} WHERE client_msg_id = ${row.client_msg_id}`
      return
    }
    const of = yield* copyOf(row)
    if (of === undefined || (yield* isKept(row))) return
    const reason = yield* copyKeepReason(row, of)
    if (reason !== undefined) {
      yield* keepCopy(row, of, reason)
      const pending = yield* copyDeleteOf(row)
      if (pending !== undefined) yield* dropAction({ ...pending, payload: { ...pending.payload, topics: messageTopics(row) } })
      return
    }
    if (yield* queueCopyDelete(row, yield* Clock.currentTimeMillis)) {
      yield* Invalidation.use((i) => i.invalidate(['outbox']))
    }
  })

/**
 * The worker is about to send `action`, a delete of the message at `ts`.
 * Run in a transaction: when it deletes a copy and deleting it would now
 * lose something, the delete is cancelled and the copy shown again.
 * Answers whether the call should go out.
 */
export const checkCopyDelete = (action: PendingAction, ts: string): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    // The user's own deletes carry the message's `client_msg_id` or wait on a post; a copy's names it by ts alone.
    if (action.kind !== 'delete' || action.dependsOn !== null || action.payload.clientMsgId !== null) return true
    const sql = yield* StoreWriter
    const copy = (yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${action.channel} AND ts = ${ts}`)[0]
    if (copy === undefined) return true
    const of = yield* copyOf(copy)
    if (of === undefined) return true
    const reason = (yield* isKept(copy)) ? 'kept' : yield* copyKeepReason(copy, of)
    if (reason === undefined) return true
    if (reason !== 'kept') yield* keepCopy(copy, of, reason)
    yield* dropAction(action)
    return false
  })
