import {
  mainTopicId,
  threadTopicId,
  type ChannelId,
  type Ts,
} from '@juno/domain'
import type { Reaction } from '@juno/slack-schema'
import { StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'
import { acknowledgeStartedThread } from '../startedThreads'
import { reconcilePost } from '../posts'
import { reconcileSent } from '../sent'

import { invalidate, type Writer } from './shared'

// Messages

export const readMessage = (channel: string, ts: string): Effect.Effect<MessageRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${channel} AND ts = ${ts}`
    return rows[0]
  })

export const writeMessage = (message: MessageRow): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const row = yield* acknowledgeStartedThread(message)
    yield* sql`INSERT INTO messages ${sql.insert(row as unknown as Record<string, unknown>)}
      ON CONFLICT (channel, ts) DO UPDATE SET
        thread_ts = excluded.thread_ts, user_id = excluded.user_id, bot_name = excluded.bot_name, bot_icon = excluded.bot_icon, subtype = excluded.subtype, text = excluded.text,
        blocks_json = excluded.blocks_json, files_json = excluded.files_json, attachments_json = excluded.attachments_json,
        edited_ts = excluded.edited_ts, deleted = excluded.deleted, client_msg_id = excluded.client_msg_id,
        reply_count = excluded.reply_count, latest_reply = excluded.latest_reply, reply_users_json = excluded.reply_users_json,
        last_event_ts = excluded.last_event_ts, partial = excluded.partial, version = excluded.version,
        ephemeral = MAX(messages.ephemeral, excluded.ephemeral), bot_id = COALESCE(excluded.bot_id, messages.bot_id)`
    // Whichever of the answer, the echo or a page stores Juno's own message first ends its pending row (5.7).
    if (row.client_msg_id !== null) yield* reconcilePost(row.client_msg_id)
    // A second copy of a post the network sent twice is hidden and deleted (ADR 0014).
    yield* reconcileSent(row)
    yield* invalidate(syncKeys.messagesOf(row))
  })

/** The topic a message belongs to: its thread, or the channel's Main. */
export function topicOfMessage(row: Pick<MessageRow, 'channel' | 'ts' | 'thread_ts'>): string {
  const channel = row.channel as ChannelId
  return row.thread_ts !== null && row.thread_ts !== row.ts ? threadTopicId(channel, row.thread_ts as Ts) : mainTopicId(channel)
}

type ReactionTarget = Pick<MessageRow, 'channel' | 'ts' | 'thread_ts' | 'subtype' | 'reply_count'>

/** A message's reactions as a page states them. Fires the message's topics, whose rows show the reactions. */
export const replaceReactions = (message: ReactionTarget, reactions: ReadonlyArray<Reaction>, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const { channel, ts } = message
    const next = reactions.map((reaction) => {
      const users = reaction.users ?? []
      return {
        name: reaction.name,
        count: reaction.count ?? users.length,
        user_ids_json: JSON.stringify(users),
        me: users.includes(selfId) ? 1 : 0,
      }
    })
    const stored = yield* sql<{ name: string; count: number; user_ids_json: string; me: number }>`
      SELECT name, count, user_ids_json, me FROM reactions WHERE channel = ${channel} AND ts = ${ts} ORDER BY rowid`
    if (stored.length === next.length && stored.every((row, index) => {
      const expected = next[index]
      return expected !== undefined && row.name === expected.name && row.count === expected.count && row.user_ids_json === expected.user_ids_json && row.me === expected.me
    })) return
    yield* sql`DELETE FROM reactions WHERE channel = ${channel} AND ts = ${ts}`
    for (const reaction of next) {
      yield* sql`INSERT INTO reactions (channel, ts, name, count, user_ids_json, me)
        VALUES (${channel}, ${ts}, ${reaction.name}, ${reaction.count}, ${reaction.user_ids_json}, ${reaction.me})`
    }
    yield* invalidate(syncKeys.messagesOf(message))
  })

/** One reaction added or removed by one user (a socket event). Fires the message's topics. */
export const changeReaction = (message: ReactionTarget, name: string, user: string, added: boolean, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const { channel, ts } = message
    yield* invalidate(syncKeys.messagesOf(message))
    const rows = yield* sql<{ count: number; user_ids_json: string | null }>`SELECT count, user_ids_json FROM reactions WHERE channel = ${channel} AND ts = ${ts} AND name = ${name}`
    const current = rows[0] === undefined ? [] : (JSON.parse(rows[0].user_ids_json ?? '[]') as Array<string>)
    const users = added ? (current.includes(user) ? current : [...current, user]) : current.filter((u) => u !== user)
    // Slack may list fewer users than its count, so the count moves by one and never below the users known.
    const before = rows[0]?.count ?? 0
    const count = Math.max(users.length, users.length === current.length ? before : added ? before + 1 : before - 1)
    if (count === 0) {
      yield* sql`DELETE FROM reactions WHERE channel = ${channel} AND ts = ${ts} AND name = ${name}`
    } else {
      yield* sql`INSERT INTO reactions (channel, ts, name, count, user_ids_json, me)
        VALUES (${channel}, ${ts}, ${name}, ${count}, ${JSON.stringify(users)}, ${users.includes(selfId) ? 1 : 0})
        ON CONFLICT (channel, ts, name) DO UPDATE SET count = excluded.count, user_ids_json = excluded.user_ids_json, me = excluded.me`
    }
  })

/** Message rows of a thread: the root and every reply. */
export const threadMessages = (channel: string, threadTs: string): Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${channel} AND (ts = ${threadTs} OR thread_ts = ${threadTs})`
  })
