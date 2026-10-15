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
 *   row in the outbox (`queueCopyDelete`). A copy with replies is left
 *   alone: deleting it would hide other people's replies.
 *
 * Only ids in `sent_posts`, and only messages by the user who sent them,
 * are reconciled, so Juno never touches a message another client or
 * another person sent.
 */
import { Clock, Effect } from 'effect'
import { Invalidation, StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { queueCopyDelete } from './actions'

interface SentRow {
  readonly channel: string
  readonly user_id: string
  readonly ts: string | null
}

/**
 * A message was stored. If it is one of Juno's sent posts, the first copy
 * keeps its ts, and any other copy is deleted.
 */
export const reconcileSent = (row: MessageRow): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (row.client_msg_id === null || row.deleted === 1) return
    const sql = yield* StoreWriter
    const sent = (yield* sql<SentRow>`SELECT channel, user_id, ts FROM sent_posts WHERE client_msg_id = ${row.client_msg_id}`)[0]
    // Another person's message can carry the same id; it is never taken for a copy.
    if (sent === undefined || sent.channel !== row.channel || sent.user_id !== row.user_id || sent.ts === row.ts) return
    if (sent.ts === null) {
      yield* sql`UPDATE sent_posts SET ts = ${row.ts} WHERE client_msg_id = ${row.client_msg_id}`
      return
    }
    if (row.reply_count > 0) return
    if (yield* queueCopyDelete(row, yield* Clock.currentTimeMillis)) {
      yield* Invalidation.use((i) => i.invalidate(['outbox']))
    }
  })
