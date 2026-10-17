/**
 * Home's rows beyond the ones that wait on the user (SPEC 12;
 * `docs/design/settled-suggestions/README.md`, "More self-management"), from
 * the cache only, with AI on or off:
 *
 * - Mentioned: the newest unread topic in an ignored channel that mentions
 *   the user by name or by a group they are in (`textMentionsMeDirectly`).
 *   It is the one way an ignored channel reaches Home; @here does not.
 * - Unfollow: followed threads with two weeks of unread replies
 *   (`unfollowEvidence`), from the unread followed topics `query.ts` read.
 * - Ignore: channels with nothing read for 30 days and more than 50
 *   messages since (`ignoreEvidence`).
 */
import type { HomeTopic, UnopenedWhy } from '@juno/contract'
import { IGNORE_MIN_MESSAGES, ignoreEvidence, millisToTs, textMentionsMeDirectly, tsToMillis, unfollowEvidence, type Me, type Ts, type UnreadStretch } from '@juno/domain'
import { StoreReader, syncState, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { HOME_SELECT, IGNORED, messagesAfter, NO_READ, OPEN, type HomeRow, type MessageRow, type Statement } from './rows'

const DAY = 24 * 60 * 60 * 1000
/** Looked at: rows active in the last `ACTIVE_DAYS`. */
const ACTIVE_DAYS = 30
/** The most each card proposes, and the channels with many unread messages looked at for Ignore. */
const SUGGESTED_SHOWN = 20
const IGNORE_READ = 40
/** Mentioned: unread topics in ignored channels looked at, newest first. */
const MENTIONED_READ = 10

/** The statements that read `topic_index` and `messages`, for the plan test. */
export const suggestedStatements = {
  /** Unread topics in ignored channels that mention the user, active since `since`, newest first, through the unread index. */
  ignoredMentions: (since: string): Statement => ({
    sql: `${HOME_SELECT} WHERE i.unread_count > 0 AND i.last_activity_ts > ? AND i.mentions_me = 1 AND ${IGNORED} ORDER BY i.last_activity_ts DESC LIMIT ?`,
    params: [since, MENTIONED_READ],
  }),
  /** Channels' Mains with more than `IGNORE_MIN_MESSAGES` unread, active since `since`, through the unread index. */
  unreadChannels: (since: string): Statement => ({
    sql: `${HOME_SELECT} WHERE i.unread_count > 0 AND i.last_activity_ts > ? AND i.unread_count > ? AND i.kind = 'main' AND c.kind IN ('public', 'private') AND ${OPEN}
      ORDER BY i.last_activity_ts DESC LIMIT ?`,
    params: [since, IGNORE_MIN_MESSAGES, IGNORE_READ],
  }),
  /** Channels with an unread mention of the user, through the unread index. */
  mentionChannels: (since: string): Statement => ({
    sql: `SELECT DISTINCT i.channel FROM topic_index i WHERE i.unread_count > 0 AND i.last_activity_ts > ? AND i.mentions_me = 1`,
    params: [since],
  }),
  /** The oldest reply in a thread after the pointer, from someone else. */
  firstThreadUnread: (channel: string, threadTs: string, after: string, selfId: string): Statement => ({
    sql: `SELECT ts FROM messages WHERE channel = ? AND thread_ts = ? AND ts > ? AND ts <> thread_ts AND deleted = 0 AND (user_id IS NULL OR user_id <> ?) ORDER BY ts LIMIT 1`,
    params: [channel, threadTs, after, selfId],
  }),
}

/** The newest direct mention of the user in an ignored channel, with its topic. */
export const readMentioned = (selfId: string, now: number): Effect.Effect<{ readonly row: HomeRow; readonly mention: MessageRow } | undefined, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const me: Me = (yield* syncState.get<Me>('me')) ?? { userId: selfId as Me['userId'] }
    const statement = suggestedStatements.ignoredMentions(millisToTs(now - ACTIVE_DAYS * DAY))
    for (const row of yield* sql.unsafe<HomeRow>(statement.sql, statement.params)) {
      const messages = yield* messagesAfter(row, row.last_read_ts ?? NO_READ)
      const mention = messages.find((message) => message.user_id !== null && message.user_id !== selfId && textMentionsMeDirectly(message.text, me))
      if (mention !== undefined) return { row, mention }
    }
    return undefined
  })

/** The proposals of one card, and the unread stretch behind each. */
export interface Suggested {
  readonly rows: ReadonlyArray<HomeRow>
  readonly unopened: ReadonlyMap<string, UnopenedWhy>
}

const stretchOf = (row: HomeRow, now: number, visits: ReadonlyMap<string, number>, kept: string | null, firstUnread: string | undefined): UnreadStretch => ({
  now,
  ...(row.last_read_ts === null ? {} : { lastRead: tsToMillis(row.last_read_ts as Ts) }),
  ...(row.root_ts === null || row.kind !== 'thread' ? {} : { start: tsToMillis(row.root_ts as Ts) }),
  ...(firstUnread === undefined ? {} : { firstUnread: tsToMillis(firstUnread as Ts) }),
  ...(row.last_activity_ts === null ? {} : { lastActivity: tsToMillis(row.last_activity_ts as Ts) }),
  unread: row.unread_count,
  exact: row.unread_exact === 1,
  mentionsMe: row.mentions_me === 1,
  markedUnread: row.marked_unread === 1,
  pinned: row.pinned_at !== null,
  ...(kept === null ? {} : { keptAt: tsToMillis(kept as Ts) }),
  ...(visits.has(row.topic_id) ? { visitedAt: visits.get(row.topic_id)! } : {}),
})

const visited = Effect.gen(function* () {
  const sql = yield* StoreReader
  return new Map((yield* sql<{ topic_id: string; seen_at: string }>`SELECT topic_id, seen_at FROM topic_visits`).map((visit) => [visit.topic_id, Number(visit.seen_at)]))
})

/** Unfollow: among the unread followed topics, the threads whose unread replies go back two weeks. */
export const readUnfollow = (unread: ReadonlyArray<HomeRow>, selfId: string, now: number): Effect.Effect<Suggested, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const visits = yield* visited
    const rows: Array<HomeRow> = []
    const unopened = new Map<string, UnopenedWhy>()
    for (const row of unread) {
      if (rows.length >= SUGGESTED_SHOWN) break
      if (row.kind !== 'thread' || row.subscribed !== 1 || row.root_ts === null) continue
      const first = suggestedStatements.firstThreadUnread(row.channel, row.root_ts, row.last_read_ts ?? row.root_ts, selfId)
      const firstUnread = (yield* sql.unsafe<{ ts: string }>(first.sql, first.params))[0]?.ts
      const evidence = unfollowEvidence(stretchOf(row, now, visits, row.unfollow_kept_ts, firstUnread))
      if (evidence === undefined) continue
      rows.push(row)
      unopened.set(row.topic_id, evidence)
    }
    return { rows, unopened }
  })

/** Ignore: channels with many unread messages and an old read pointer, never one with an unread mention of the user. */
export const readIgnore = (now: number): Effect.Effect<Suggested, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const visits = yield* visited
    const since = millisToTs(now - ACTIVE_DAYS * DAY)
    const mentions = suggestedStatements.mentionChannels(since)
    const mentioned = new Set((yield* sql.unsafe<{ channel: string }>(mentions.sql, mentions.params)).map((row) => row.channel))
    const channels = suggestedStatements.unreadChannels(since)
    const rows: Array<HomeRow> = []
    const unopened = new Map<string, UnopenedWhy>()
    for (const row of yield* sql.unsafe<HomeRow>(channels.sql, channels.params)) {
      if (rows.length >= SUGGESTED_SHOWN) break
      const evidence = ignoreEvidence({ ...stretchOf(row, now, visits, row.ignore_kept_ts, undefined), mentionsMe: mentioned.has(row.channel) })
      if (evidence === undefined) continue
      rows.push(row)
      unopened.set(row.topic_id, evidence)
    }
    return { rows, unopened }
  })

/** A topic of the Unfollow or Ignore card, with its latest activity and the unread stretch its reason says. */
export function withUnopened(topic: HomeTopic, row: HomeRow, why: UnopenedWhy | undefined): HomeTopic {
  return { ...topic, ...(row.last_activity_ts === null ? {} : { at: tsToMillis(row.last_activity_ts as Ts) }), ...(why === undefined ? {} : { unopened: why }) }
}
