/**
 * The statements behind `messages.list`, `channel.threads` and the header's
 * thread count (performance 6). Each reads at most its window through an
 * index; `test/plan.test.ts` checks that none scans `messages`,
 * `topic_index`, `reactions` or `topic_overlay`.
 *
 * - Main: the channel's roots and broadcast replies, through the partial
 *   index `messages_main (channel, ts)`. The query repeats the index's
 *   condition word for word (`MAIN_CONDITION`), which is what lets SQLite
 *   use a partial index.
 * - A thread: the root and its replies, `thread_ts` equal to the root, through
 *   `messages_thread (channel, thread_ts, ts)`.
 *
 * Both hide what Slack hides: a deleted reply, and a deleted Main message
 * without replies. A deleted root with replies keeps its place.
 */
import type { MessageRow } from '@juno/store'

/** The condition of the `messages_main` partial index, as the migration writes it. */
export const MAIN_CONDITION = `(thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')`

/** The columns a message row needs. */
export const MESSAGE_COLUMNS = `channel, ts, thread_ts, user_id, bot_name, bot_icon, subtype, text, blocks_json, files_json, attachments_json,
  edited_ts, deleted, client_msg_id, reply_count, latest_reply, version, last_event_ts`

export type WindowMessage = Pick<
  MessageRow,
  | 'channel'
  | 'ts'
  | 'thread_ts'
  | 'user_id'
  | 'bot_name'
  | 'bot_icon'
  | 'subtype'
  | 'text'
  | 'blocks_json'
  | 'files_json'
  | 'attachments_json'
  | 'edited_ts'
  | 'deleted'
  | 'client_msg_id'
  | 'reply_count'
  | 'latest_reply'
  | 'version'
  | 'last_event_ts'
>

export type WindowTarget = { readonly kind: 'main'; readonly channel: string } | { readonly kind: 'thread'; readonly channel: string; readonly threadTs: string }

export interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

const scope = (target: WindowTarget): Statement =>
  target.kind === 'main'
    ? { sql: `channel = ? AND ${MAIN_CONDITION} AND (deleted = 0 OR reply_count > 0)`, params: [target.channel] }
    : { sql: `channel = ? AND thread_ts = ? AND (deleted = 0 OR ts = thread_ts)`, params: [target.channel, target.threadTs] }

/**
 * The window's statements. Without an anchor: the newest `limit` rows. With
 * one: up to `before` rows older than the anchor, then the anchor and newer
 * rows up to `limit` in all. Rows come newest first from the first
 * statement and oldest first from the second; the caller orders them.
 *
 * The first statement reads one row more than the window holds: the message
 * just before the window, when there is one. It is not shown; it only says
 * whether the window's first row starts a sender group, so that row keeps
 * its header (and its height) when an older page arrives above it.
 */
export function windowStatements(target: WindowTarget, range: { readonly anchor?: string | undefined; readonly before: number; readonly limit: number }): ReadonlyArray<Statement> {
  const where = scope(target)
  if (range.anchor === undefined) {
    return [{ sql: `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where.sql} ORDER BY ts DESC LIMIT ?`, params: [...where.params, range.limit + 1] }]
  }
  const before = Math.min(range.before, range.limit)
  return [
    { sql: `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where.sql} AND ts < ? ORDER BY ts DESC LIMIT ?`, params: [...where.params, range.anchor, before + 1] },
    { sql: `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where.sql} AND ts >= ? ORDER BY ts ASC LIMIT ?`, params: [...where.params, range.anchor, range.limit] },
  ]
}

/** The topic's pending messages (architecture 5.7), oldest first, through `pending_messages_channel (channel, thread_ts)`. */
export function pendingStatement(target: WindowTarget): Statement {
  const columns = 'client_msg_id, channel, thread_ts, text, blocks_json, file_ids_json, created_at, state'
  return target.kind === 'main'
    ? { sql: `SELECT ${columns} FROM pending_messages WHERE channel = ? AND thread_ts IS NULL ORDER BY created_at, client_msg_id`, params: [target.channel] }
    : { sql: `SELECT ${columns} FROM pending_messages WHERE channel = ? AND thread_ts = ? ORDER BY created_at, client_msg_id`, params: [target.channel, target.threadTs] }
}

/** Juno's own edits, deletes and reactions in a channel that Slack has not confirmed (architecture 5.7), through `outbox_target`. */
export function actionsStatement(channel: string): Statement {
  return { sql: `SELECT id, kind, payload_json FROM outbox WHERE target_key = ? AND kind IN ('edit', 'delete', 'react') ORDER BY id`, params: [channel] }
}

/** Network copies of Juno's posts that stay hidden though not deleted (file copies, ADR 0014), by primary key. */
export function hiddenCopiesStatement(channel: string): Statement {
  return { sql: `SELECT ts FROM kept_copies WHERE channel = ? AND hidden = 1`, params: [channel] }
}

/** Reactions of the window's messages, by primary key. */
export function reactionsStatement(channel: string, ts: ReadonlyArray<string>): Statement {
  return {
    sql: `SELECT ts, name, count, me FROM reactions WHERE channel = ? AND ts IN (${ts.map(() => '?').join(', ')}) ORDER BY ts, rowid`,
    params: [channel, ...ts],
  }
}

/** The overlay titles of the threads a Main window links to, by primary key. */
export function threadTitlesStatement(topicIds: ReadonlyArray<string>): Statement {
  return {
    sql: `SELECT topic_id, manual_title, ai_title FROM topic_overlay WHERE topic_id IN (${topicIds.map(() => '?').join(', ')})`,
    params: topicIds,
  }
}

/**
 * A channel's threads with activity since `cutoff`, newest first, through
 * `topic_index_channel_activity (channel, last_activity_ts DESC)`, with
 * what a `ThreadSummary` shows. `count` is the number of such threads.
 */
export function threadsStatements(channel: string, cutoff: string, limit: number): { readonly list: Statement; readonly count: Statement } {
  const where = `i.channel = ? AND i.kind = 'thread' AND i.last_activity_ts >= ?`
  return {
    list: {
      sql: `SELECT i.topic_id, i.root_ts, i.last_activity_ts, i.message_count, i.unread_count, i.unread_exact, i.mentions_me,
          i.participants_json, i.preview_json, i.rev, o.manual_title, o.ai_title
        FROM topic_index i
        LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
        WHERE ${where} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [channel, cutoff, limit],
    },
    count: { sql: `SELECT count(*) AS n FROM topic_index i WHERE ${where}`, params: [channel, cutoff] },
  }
}
