/**
 * What Home's queries share (`query.ts`, `suggested.ts`, `reviewCards.ts`, `job.ts`): the row
 * they read, the clauses that say which topics count, and the messages
 * after a read pointer.
 */
import { StoreReader, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { TOPIC_COLUMNS, TOPIC_FROM, type JoinedRow } from '../topicRows'

/** A topic row with Juno's read pointer, and when the user said no to Unfollow or Ignore. */
export interface HomeRow extends JoinedRow {
  readonly last_read_ts: string | null
  readonly marked_unread: 0 | 1 | null
  readonly unfollow_kept_ts: string | null
  readonly ignore_kept_ts: string | null
}

/** Open: a member of a live channel that is not ignored, and not resolved (or reopened by later activity). */
export const OPEN = `c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
  AND (o.resolved_at IS NULL OR (o.resolved_activity_ts IS NOT NULL AND i.last_activity_ts > o.resolved_activity_ts))`
/** Followed: a thread Slack follows, or a DM's Main. A channel's Main is a stream, not a topic the user follows. */
export const FOLLOWED = `((i.kind = 'thread' AND s.subscribed = 1) OR (i.kind = 'main' AND c.kind IN ('im', 'mpim')))`
/** A live channel the user is in and ignores. */
export const IGNORED = `c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NOT NULL`

export const HOME_SELECT = `${TOPIC_COLUMNS}, NULL AS channel_activity_ts, r.last_read_ts AS last_read_ts, r.marked_unread AS marked_unread,
  o.unfollow_kept_ts AS unfollow_kept_ts, o.ignore_kept_ts AS ignore_kept_ts ${TOPIC_FROM}
  LEFT JOIN topic_reads r ON r.topic_id = i.topic_id`

export interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<string | number>
}

/** Unread messages read per topic when looking for a question. */
const QUESTION_WINDOW = 50

/** A thread's replies or a Main's top-level messages after a pointer, newest first. */
export const messageStatements = {
  threadAfter: (channel: string, threadTs: string, after: string, limit = QUESTION_WINDOW): Statement => ({
    sql: `SELECT ts, user_id, text, files_json FROM messages WHERE channel = ? AND thread_ts = ? AND ts > ? AND deleted = 0 ORDER BY ts DESC LIMIT ?`,
    params: [channel, threadTs, after, limit],
  }),
  mainAfter: (channel: string, after: string, limit = QUESTION_WINDOW): Statement => ({
    sql: `SELECT ts, user_id, text, files_json FROM messages WHERE channel = ? AND ts > ? AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') AND deleted = 0
      ORDER BY ts DESC LIMIT ?`,
    params: [channel, after, limit],
  }),
}

export interface MessageRow {
  readonly ts: string
  readonly user_id: string | null
  readonly text: string
  readonly files_json: string | null
}

/** The messages after `after`, newest first: a thread's replies, or a Main's top-level messages. */
export const messagesAfter = (
  row: Pick<JoinedRow, 'kind' | 'channel' | 'root_ts'>,
  after: string,
  limit?: number,
): Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement =
      row.kind === 'thread' && row.root_ts !== null ? messageStatements.threadAfter(row.channel, row.root_ts, after, limit) : messageStatements.mainAfter(row.channel, after, limit)
    return yield* sql.unsafe<MessageRow>(statement.sql, statement.params)
  })

export const NO_READ = '0000000000.000000'
