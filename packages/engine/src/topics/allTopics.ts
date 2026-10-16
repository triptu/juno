/**
 * The All topics queries (spec section 11, architecture 4.4).
 *
 * All topics lists every topic of every conversation the user is in,
 * except ignored channels, so a run has to look at the whole index to sort
 * it, count it by status and say how long it is. It does that in two steps:
 *
 * 1. The order: one statement over the member conversations, each probing
 *    its topics on `topic_index_channel_activity`, that computes every
 *    topic's status in SQL (`STATUS`, the domain's `topicStatus` written
 *    out), filters by the chip, the kind, the place and the text, sorts,
 *    and returns only the window's ids and the list's length
 *    (`count(*) OVER ()`). No row is shaped here.
 * 2. The window: the joined rows for those ids by primary key, shaped by
 *    the sidebar's `shapeRows`, with the status the pure rule gives.
 *
 * The text filter is a full-text search, as in ⌘K: titles (the root's text
 * and the renamed and AI titles) and every message, each word a prefix.
 * A message counts for the topic it is in: its thread, or the thread it
 * started, or its channel's Main.
 *
 * The summary counts the topics per status with the same statement grouped,
 * and lists the conversations of the kind filter that have topics.
 */
import { allTopicsStatus, quietDaysOf, type ConversationKind, type RuleContext } from '@juno/domain'
import type { AllTopicsCounts, AllTopicsFilter, AllTopicsSummary, ChannelRef, KindFilter, TopicListRow } from '@juno/contract'
import { ftsQuery, StoreReader, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { ListRun } from '../protocol/live'
import { channelInfoOf, channelRefOf, parseIds, userName, type UserRow } from '../topicRows'
import { cutoffTs, FROM, kindClause, rowsCovered, SELECT, settings, shapeRows, type ListRow, type RowCache } from './query'

/** The filters that narrow the list before the chip: kind, place and text. */
export type Narrowing = Pick<AllTopicsFilter, 'kind' | 'scope' | 'query'>

/**
 * A Main's quiet rule reads the latest activity anywhere in its channel
 * (one probe on `topic_index_channel_activity`); a thread reads its own.
 */
const LATEST = `CASE WHEN i.kind = 'main' THEN (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = i.channel) ELSE i.last_activity_ts END`

/**
 * `topicStatus` in SQL, for topics outside ignored channels: unfollowed
 * thread, then resolved with no activity after the resolve, then quiet
 * (older than the cutoff, not pinned, nothing unread), else open. The one
 * parameter is the cutoff.
 */
const STATUS = `CASE
    WHEN i.kind = 'thread' AND s.subscribed = 0 THEN 'unsubscribed'
    WHEN o.resolved_at IS NOT NULL AND NOT (o.resolved_activity_ts IS NOT NULL AND i.last_activity_ts > o.resolved_activity_ts) THEN 'resolved'
    WHEN o.pinned_at IS NULL AND i.unread_count = 0 AND ${LATEST} < ? THEN 'quiet'
    ELSE 'open'
  END`

/**
 * The topics a word search finds: by the root's text, by a renamed or AI
 * title, and by any message in them. Each branch is an FTS lookup; the
 * messages join by rowid.
 */
const MATCHES = `i.topic_id IN (
    SELECT ti.topic_id FROM topic_titles_fts f JOIN topic_index ti ON ti.rowid = f.rowid WHERE topic_titles_fts MATCH ?
    UNION SELECT ov.topic_id FROM overlay_titles_fts f JOIN topic_overlay ov ON ov.rowid = f.rowid WHERE overlay_titles_fts MATCH ?
    UNION SELECT CASE WHEN m.thread_ts IS NOT NULL THEN 't:' || m.channel || ':' || m.thread_ts
        WHEN m.reply_count > 0 THEN 't:' || m.channel || ':' || m.ts
        ELSE 'm:' || m.channel END
      FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ? AND m.deleted = 0)`

/** The FTS query for the text filter, each word a prefix; empty when there is nothing to find. */
export function matchQuery(text: string | undefined): string {
  const terms = ftsQuery((text ?? '').trim())
  return terms === '' ? '' : terms.replaceAll('" "', '"* "').concat('*')
}

/**
 * Every topic under the narrowing, with its status, as a subquery with its
 * parameters. Driven from the member conversations (`CROSS JOIN` keeps that
 * order), so each conversation reads its topics through the channel index
 * and nothing scans `topic_index`.
 */
function statusRows(narrowing: Narrowing, cutoff: string): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  const match = matchQuery(narrowing.query)
  const scope = narrowing.scope === undefined ? '' : ' AND c.id = ?'
  return {
    sql: `SELECT i.topic_id AS topic_id, i.last_activity_ts AS at, i.message_count AS messages, ${STATUS} AS status
      FROM conversations c CROSS JOIN topic_index i ON i.channel = c.id
      LEFT JOIN ignored_channels ig ON ig.channel = c.id
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts
      WHERE c.is_member = 1 AND ig.channel IS NULL AND i.kind IN ('thread', 'main') AND i.last_activity_ts IS NOT NULL${scope}${kindClause(narrowing.kind)}${match === '' ? '' : ` AND ${MATCHES}`}`,
    params: [cutoff, ...(narrowing.scope === undefined ? [] : [narrowing.scope]), ...(match === '' ? [] : [match, match, match])],
  }
}

const ORDER: Record<AllTopicsFilter['sort'], string> = {
  // `byLatestActivity`: newest first, then by id; oldest first is its reverse.
  recent: 'at DESC, topic_id ASC',
  oldest: 'at ASC, topic_id DESC',
  messages: 'messages DESC, at DESC, topic_id ASC',
}

/** The order statement: the window's ids at `offset` and the length of the whole list. Exported for the plan test. */
export function orderStatement(filter: AllTopicsFilter, cutoff: string, offset: number, limit: number): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  const rows = statusRows(filter, cutoff)
  const chip = filter.status === 'all' ? '' : ' WHERE status = ?'
  return {
    sql: `SELECT topic_id, count(*) OVER () AS total FROM (${rows.sql})${chip} ORDER BY ${ORDER[filter.sort]} LIMIT ? OFFSET ?`,
    params: [...rows.params, ...(filter.status === 'all' ? [] : [filter.status]), limit, offset],
  }
}

/** The counts statement: topics per status under the narrowing. Exported for the plan test. */
export function countsStatement(narrowing: Narrowing, cutoff: string): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  const rows = statusRows(narrowing, cutoff)
  return { sql: `SELECT status, count(*) AS n FROM (${rows.sql}) GROUP BY status`, params: rows.params }
}

/** The places statement: member conversations of the kind, not ignored, that have a topic. Exported for the plan test. */
export function placesStatement(kind: KindFilter): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  return {
    sql: `SELECT c.id AS channel, c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members
      FROM conversations c LEFT JOIN ignored_channels ig ON ig.channel = c.id
      WHERE c.is_member = 1 AND ig.channel IS NULL${kindClause(kind)}
        AND EXISTS (SELECT 1 FROM topic_index t WHERE t.channel = c.id AND t.last_activity_ts IS NOT NULL)`,
    params: [],
  }
}

/** The rule context and cutoff of a run: the quiet window from prefs. */
const ruleContext = (now: number, quietDays: number | undefined): { readonly ctx: RuleContext; readonly cutoff: string } => {
  const ctx = { now, ...(quietDays === undefined ? {} : { quietDays }) }
  return { ctx, cutoff: cutoffTs(now, quietDaysOf(ctx)) }
}

/**
 * One window of All topics: `limit` rows from `offset` in the filter's
 * order, shaped as sidebar rows, and the length of the whole list as
 * `total`. A row's `section` is `pinned` for a pinned topic and `recent`
 * otherwise; its `status` is the chip it counts under.
 */
export const listAllTopics = (
  filter: AllTopicsFilter,
  options: { readonly now: number; readonly offset: number; readonly limit: number },
  cache: RowCache,
): Effect.Effect<ListRun<TopicListRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { quietDays, aiAssist, selfId } = yield* settings
    const { ctx, cutoff } = ruleContext(options.now, quietDays)
    const order = orderStatement(filter, cutoff, options.offset, options.limit)
    const ids = yield* sql.unsafe<{ topic_id: string; total: number }>(order.sql, order.params)
    const total = ids[0]?.total ?? 0
    const joined = ids.length === 0 ? [] : yield* sql.unsafe<ListRow>(`${SELECT}${FROM} WHERE i.topic_id IN (${ids.map(() => '?').join(', ')})`, ids.map((row) => row.topic_id))
    const byId = new Map(joined.map((row) => [row.topic_id, row]))
    const inOrder = ids.flatMap((row) => byId.get(row.topic_id) ?? [])
    const shaper = yield* shapeRows(inOrder, { selfId, aiAssist }, cache)
    for (const entry of shaper.entries) shaper.place(entry, entry.topic.overlay.pinnedAt === undefined ? 'recent' : 'pinned', allTopicsStatus(entry.topic, ctx))
    // When the index moved between the two statements a row can be missing; the next run puts it back.
    return { ...shaper.finish(Math.max(total, options.offset + shaper.entries.length)), windowCovered: yield* rowsCovered }
  })

const emptyCounts = (): { -readonly [K in keyof AllTopicsCounts]: number } => ({ all: 0, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 })

interface PlaceRow {
  readonly channel: string
  readonly c_kind: ConversationKind
  readonly c_name: string | null
  readonly c_user_id: string | null
  readonly c_members: string | null
}

const KIND_ORDER: Record<ConversationKind, number> = { public: 0, private: 0, im: 1, mpim: 1 }

/** The chips' counts under the narrowing, and the places the select lists: channels by name, then DMs by name. */
export const summarizeAllTopics = (narrowing: Narrowing, now: number): Effect.Effect<AllTopicsSummary, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { quietDays, selfId } = yield* settings
    const { cutoff } = ruleContext(now, quietDays)
    const statement = countsStatement(narrowing, cutoff)
    const counts = emptyCounts()
    for (const row of yield* sql.unsafe<{ status: Exclude<keyof AllTopicsCounts, 'all'>; n: number }>(statement.sql, statement.params)) {
      counts[row.status] += row.n
      counts.all += row.n
    }

    const places = placesStatement(narrowing.kind)
    const rows = yield* sql.unsafe<PlaceRow>(places.sql, places.params)
    const members = new Map(rows.map((row) => [row.channel, row.c_kind === 'mpim' ? parseIds(row.c_members) : []]))
    const userIds = new Set<string>()
    for (const row of rows) {
      if (row.c_user_id !== null) userIds.add(row.c_user_id)
      for (const id of members.get(row.channel)!) userIds.add(id)
    }
    const users = new Map<string, UserRow>()
    if (userIds.size > 0) {
      for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...userIds])}`) users.set(user.id, user)
    }
    const refs: Array<ChannelRef> = rows.map((row) => {
      const info = channelInfoOf(row, { members: members.get(row.channel)! }, selfId, (id) => userName(id, users.get(id)))
      return channelRefOf(info, row.c_kind === 'im' && row.c_user_id !== null ? row.c_user_id : undefined)
    })
    refs.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return { counts, places: refs }
  })
