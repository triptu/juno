/**
 * The New chat pickers' queries (spec section 9). Local only: they read the
 * conversations, people and topics the sync stored. Conversation search
 * matches words in memory (`searchIndex.ts`). The statements that
 * read `topic_index` are in `pickerStatements`, so the plan test can check
 * that each one reads it through an index (performance 6).
 */
import { PALETTE_CONVERSATIONS, PICK_LIMIT, RECENT_CONVERSATIONS, type PickConversation, type PickConversations, type PickThread } from '@juno/contract'
import { frequentDestinations, firstWords, parseTopicId, rankConversations, rankSearchResults, searchWords, tsToMillis, type Ts } from '@juno/domain'
import { ftsQuery, StoreReader, type SqlClient } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { UserRow } from '../topicRows'
import { CONVERSATION_COLUMNS, peopleOf, pickOf, type ConversationRow } from './picks'
import { searchEntries, type Found } from './searchIndex'

/** How far back Recent and the threads from everywhere look. */
const RECENT_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/** Seconds as a Slack ts, for comparing with `last_activity_ts`. */
const cutoffTs = (now: number) => `${Math.floor((now - RECENT_DAYS * DAY) / 1000)}.000000`

interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<string | number>
}

/**
 * The statements that read `topic_index`: the recent conversations, and the
 * threads of a channel or from everywhere, matching `match` (an FTS query)
 * when there is one.
 */
export function pickerStatements(cutoff: string, channel: string | undefined, match: string | undefined): { readonly recent: Statement; readonly threads: Statement } {
  // Grouped by channel, the planner would walk the whole channel index; the activity index reads only the last RECENT_DAYS.
  const recent = {
    sql: `SELECT ${CONVERSATION_COLUMNS} FROM conversations c
      JOIN (SELECT channel, MAX(last_activity_ts) AS activity FROM topic_index INDEXED BY topic_index_activity WHERE last_activity_ts > ? GROUP BY channel) a ON a.channel = c.id
      LEFT JOIN ignored_channels g ON g.channel = c.id
      WHERE c.is_member = 1 AND g.channel IS NULL
      ORDER BY a.activity DESC, c.id LIMIT ?`,
    params: [cutoff, RECENT_CONVERSATIONS],
  }
  const where = ["i.kind = 'thread'", 'c.is_member = 1', 'g.channel IS NULL']
  const params: Array<string | number> = []
  if (channel !== undefined) {
    where.push('i.channel = ?')
    params.push(channel)
  } else if (match === undefined) {
    where.push('i.last_activity_ts > ?')
    params.push(cutoff)
  }
  if (match !== undefined) {
    where.push(`i.topic_id IN (
      SELECT t.topic_id FROM topic_titles_fts f JOIN topic_index t ON t.rowid = f.rowid WHERE topic_titles_fts MATCH ?
      UNION SELECT o.topic_id FROM overlay_titles_fts f JOIN topic_overlay o ON o.rowid = f.rowid WHERE overlay_titles_fts MATCH ?)`)
    params.push(match, match)
  }
  params.push(PICK_LIMIT)
  const threads = {
    sql: `SELECT ${CONVERSATION_COLUMNS}, i.topic_id, i.root_ts, i.last_activity_ts, i.message_count,
        COALESCE(NULLIF(trim(o.manual_title), ''), NULLIF(trim(o.ai_title), '')) AS named_title,
        COALESCE(json_extract(i.preview_json, '$.rootText'), '') AS root_text
      FROM topic_index i JOIN conversations c ON c.id = i.channel
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN ignored_channels g ON g.channel = i.channel
      WHERE ${where.join(' AND ')}
      ORDER BY i.last_activity_ts DESC, i.topic_id LIMIT ?`,
    params,
  }
  return { recent, threads }
}

const readUsers = (sql: SqlClient.SqlClient, ids: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const users = new Map<string, UserRow>()
    if (ids.size === 0) return users
    const rows = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of rows) users.set(row.id, row)
    return users
  })

const selfIdOf = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`, (rows) => rows[0]?.self_user_id ?? undefined)

/** The conversation picker's sections for `text` (see `newChat.conversations`). */
export const queryConversations = Effect.fn('newChat.conversations')(function* (text: string) {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const now = yield* Clock.currentTimeMillis
  if (searchWords(text).length === 0) {
    const { recent } = pickerStatements(cutoffTs(now), undefined, undefined)
    const rows = yield* sql.unsafe<ConversationRow>(recent.sql, recent.params)
    const users = yield* readUsers(sql, peopleOf(rows))
    return { recent: rows.map((row) => pickOf(row, users, selfId)), people: [], channels: [] } satisfies PickConversations
  }
  const ranked = yield* rankFound(sql, yield* searchEntries(text), yield* usesOf(sql, selfId, now), now)
  return {
    recent: [],
    people: ranked.filter((pick) => pick.kind === 'im').slice(0, PICK_LIMIT),
    channels: ranked.filter((pick) => pick.kind !== 'im').slice(0, PICK_LIMIT),
  } satisfies PickConversations
})

interface ThreadRow extends ConversationRow {
  readonly topic_id: string
  readonly root_ts: string
  readonly last_activity_ts: string | null
  readonly message_count: number
  readonly named_title: string | null
  readonly root_text: string
}

/** The thread picker's rows for `channel` (or everywhere) and `text` (see `newChat.threads`). */
export const queryThreads = Effect.fn('newChat.threads')(function* (channel: string | undefined, text: string) {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const terms = ftsQuery(text.trim())
  const { threads } = pickerStatements(cutoffTs(yield* Clock.currentTimeMillis), channel, terms === '' ? undefined : `${terms}*`)
  const rows = yield* sql.unsafe<ThreadRow>(threads.sql, threads.params)
  const users = yield* readUsers(sql, peopleOf(rows))
  return rows.map(
    (row): PickThread => ({
      id: row.topic_id,
      rootTs: row.root_ts,
      title: row.named_title || firstWords(row.root_text) || 'Thread',
      replyCount: Math.max(0, row.message_count - 1),
      lastActivityAt: row.last_activity_ts === null ? 0 : tsToMillis(row.last_activity_ts as Ts),
      conversation: pickOf(row, users, selfId),
    }),
  )
})

/** Indexed own-message range used by Frequent, also checked by the plan gate. */
export const frequentSendsStatement = (selfId: string, now: number) => ({
  sql: `SELECT channel, ts FROM messages INDEXED BY messages_sender_ts
    WHERE user_id = ? AND ts >= ? AND ts <= ? AND deleted = 0`,
  params: [selfId, ((now - 30 * DAY) / 1000).toFixed(6), (now / 1000).toFixed(6)],
})

/** Member destinations and their latest cached activity, using the channel index. */
export const frequentConversationsStatement = `SELECT ${CONVERSATION_COLUMNS},
  (SELECT MAX(t.last_activity_ts) FROM topic_index t WHERE t.channel = c.id) AS activity
  FROM conversations c LEFT JOIN ignored_channels g ON g.channel = c.id
  WHERE c.is_member = 1 AND c.is_archived = 0 AND g.channel IS NULL`

/** Local ranking only; no Slack fetch, including when the message cache is empty. */
export const queryFrequent = Effect.fn('newChat.frequent')(function* () {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const now = yield* Clock.currentTimeMillis
  const rows = yield* sql.unsafe<ConversationRow & { activity: string | null }>(frequentConversationsStatement)
  const statement = frequentSendsStatement(selfId ?? '', now)
  const sends = yield* sql.unsafe<{ channel: string; ts: string }>(statement.sql, statement.params)
  const ids = frequentDestinations(rows.map(row => ({ id: row.id, kind: row.kind, lastActivityAt: Number(row.activity ?? 0) * 1000 })),
    sends.map(row => ({ channel: row.channel, at: Number(row.ts) * 1000 })), now)
  const byId = new Map(rows.map(row => [row.id, row]))
  const chosen = ids.flatMap(id => { const row = byId.get(id); return row === undefined ? [] : [row] })
  const users = yield* readUsers(sql, peopleOf(chosen))
  return chosen.map(row => pickOf(row, users, selfId))
})

/** The latest activity of each of `ids`, read through the channel index. A conversation with no row has no topics. */
export const activityStatement = (ids: ReadonlyArray<string>) => ({
  sql: `SELECT channel, MAX(last_activity_ts) AS activity FROM topic_index WHERE channel IN (${ids.map(() => '?').join(', ')}) GROUP BY channel`,
  params: ids,
})

/**
 * Search matches in rank order (`rankSearchResults`), each with whether
 * Juno holds messages in it and the parts of its name to highlight. Only
 * the matched conversations' activity is read, through the channel index.
 */
const rankFound = (sql: SqlClient.SqlClient, found: ReadonlyArray<Found>, uses: ReadonlyArray<{ readonly channel: string; readonly at: number }>, now: number) =>
  Effect.gen(function* () {
    const ids = found.flatMap(({ entry }) => entry.pick.channelId ?? [])
    const activity = new Map<string, number>()
    if (ids.length > 0) {
      const statement = activityStatement(ids)
      for (const row of yield* sql.unsafe<{ channel: string; activity: string | null }>(statement.sql, statement.params)) activity.set(row.channel, Number(row.activity ?? 0) * 1000)
    }
    const byKey = new Map(found.map((each) => [each.entry.pick.key, each]))
    const order = rankSearchResults(
      found.map(({ entry, match }) => ({ id: entry.pick.key, kind: entry.pick.kind, lastActivityAt: activity.get(entry.pick.key) ?? 0, match })),
      uses,
      now,
    )
    return order.flatMap((key): ReadonlyArray<PickConversation> => {
      const each = byKey.get(key)
      if (each === undefined) return []
      const { pick } = each.entry
      const channelId = pick.channelId
      return [{ ...pick, empty: channelId === undefined || !activity.has(channelId), ...(each.match.ranges.length === 0 ? {} : { highlight: each.match.ranges }) }]
    })
  })

/** Own sends and topic visits, each a use of its conversation, for the palette's ranking. */
const usesOf = (sql: SqlClient.SqlClient, selfId: string | undefined, now: number) =>
  Effect.gen(function* () {
    const statement = frequentSendsStatement(selfId ?? '', now)
    const sends = yield* sql.unsafe<{ channel: string; ts: string }>(statement.sql, statement.params)
    const visits = yield* sql<{ topic_id: string; seen_at: string | number }>`SELECT topic_id, seen_at FROM topic_visits`
    return [
      ...sends.map((row) => ({ channel: row.channel, at: Number(row.ts) * 1000 })),
      ...visits.flatMap((row) => {
        const parsed = parseTopicId(row.topic_id)
        return parsed === undefined ? [] : [{ channel: parsed.channel as string, at: Number(row.seen_at) }]
      }),
    ]
  })

/**
 * The ⌘K Conversations tab (spec section 10): DMs, group DMs and channels
 * by how much you use them, own sends and topic visits decaying by half
 * each week, then by activity. With text, the conversations the New chat
 * picker finds for it, by how well they match, then ranked the same way
 * (`rankSearchResults`). Local only.
 */
export const queryPaletteConversations = Effect.fn('newChat.ranked')(function* (text: string) {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const now = yield* Clock.currentTimeMillis
  const uses = yield* usesOf(sql, selfId, now)
  if (searchWords(text).length === 0) {
    const rows = yield* sql.unsafe<ConversationRow & { activity: string | null }>(frequentConversationsStatement)
    const ids = rankConversations(rows.map((row) => ({ id: row.id, kind: row.kind, lastActivityAt: Number(row.activity ?? 0) * 1000 })), uses, now).slice(0, PALETTE_CONVERSATIONS)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const chosen = ids.flatMap((id) => byId.get(id) ?? [])
    const users = yield* readUsers(sql, peopleOf(chosen))
    return chosen.map((row) => pickOf(row, users, selfId))
  }
  const ranked = yield* rankFound(sql, yield* searchEntries(text), uses, now)
  return ranked.slice(0, PALETTE_CONVERSATIONS)
})
