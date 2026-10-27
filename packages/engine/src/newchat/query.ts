/**
 * The destination queries for Home's composer and ⌘K (spec sections 10 and
 * 12). Local only: they read the conversations, people and topics the sync
 * stored. Conversation search
 * matches words in memory (`searchIndex.ts`). The statements that
 * read `topic_index` are in `pickerStatements`, so the plan test can check
 * that each one reads it through an index (performance 6).
 */
import { PALETTE_CONVERSATIONS, PICK_LIMIT, RECENT_CONVERSATIONS, type PickConversation, type PickConversations } from '@juno/contract'
import { parseTopicId, rankConversations, rankSearchResults, searchWords } from '@juno/domain'
import { StoreReader, type SqlClient } from '@juno/store'
import { Clock, Effect } from 'effect'
import { aiAssistOn } from '../ai'
import type { UserRow } from '../topicRows'
import { CONVERSATION_COLUMNS, peopleOf, pickOf, type ConversationRow } from './picks'
import { searchEntries, type Found } from './searchIndex'

/** How far back the destination list's recent conversations look. */
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
export function pickerStatements(cutoff: string): { readonly recent: Statement } {
  // Grouped by channel, the planner would walk the whole channel index; the activity index reads only the last RECENT_DAYS.
  const recent = {
    sql: `SELECT ${CONVERSATION_COLUMNS} FROM conversations c
      JOIN (SELECT channel, MAX(last_activity_ts) AS activity FROM topic_index INDEXED BY topic_index_activity WHERE last_activity_ts > ? GROUP BY channel) a ON a.channel = c.id
      LEFT JOIN ignored_channels g ON g.channel = c.id
      WHERE c.is_member = 1 AND g.channel IS NULL
      ORDER BY a.activity DESC, c.id LIMIT ?`,
    params: [cutoff, RECENT_CONVERSATIONS],
  }
  return { recent }
}

const readUsers = (sql: SqlClient.SqlClient, ids: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const users = new Map<string, UserRow>()
    if (ids.size === 0) return users
    const rows = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of rows) users.set(row.id, row)
    return users
  })

/**
 * `picks` with each channel's Main art (`PickConversation.art`), so a tile
 * matches the channel's Main row in the sidebar. Read per query, like
 * `empty`, so a new drawing shows at once; nothing while AI assist is off.
 */
const withMainArt = (sql: SqlClient.SqlClient, picks: ReadonlyArray<PickConversation>) =>
  Effect.gen(function* () {
    const mains = picks.flatMap((pick) => (pick.mainId !== undefined && (pick.kind === 'public' || pick.kind === 'private') ? [pick.mainId] : []))
    if (mains.length === 0 || !(yield* aiAssistOn)) return picks
    const rows = yield* sql<{ topic_id: string; recipe: string }>`SELECT topic_id, recipe FROM topic_art WHERE status = 'ok' AND recipe != '' AND topic_id IN ${sql.in(mains)}`
    if (rows.length === 0) return picks
    const art = new Map(rows.map((row) => [row.topic_id, row.recipe]))
    return picks.map((pick) => {
      const recipe = pick.mainId === undefined ? undefined : art.get(pick.mainId)
      return recipe === undefined ? pick : { ...pick, art: recipe }
    })
  })

const selfIdOf = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`, (rows) => rows[0]?.self_user_id ?? undefined)

/** The conversation picker's sections for `text` (see `newChat.conversations`). */
export const queryConversations = Effect.fn('newChat.conversations')(function* (text: string) {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const now = yield* Clock.currentTimeMillis
  if (searchWords(text).length === 0) {
    const { recent } = pickerStatements(cutoffTs(now))
    const rows = yield* sql.unsafe<ConversationRow>(recent.sql, recent.params)
    const users = yield* readUsers(sql, peopleOf(rows))
    return { recent: yield* withMainArt(sql, rows.map((row) => pickOf(row, users, selfId))), people: [], channels: [] } satisfies PickConversations
  }
  // A channel you are not in is ⌘K's alone (SPEC 10): a message goes where you are.
  const found = yield* rankFound(sql, (yield* searchEntries(text)).filter(({ entry }) => entry.pick.notJoined !== true), yield* usesOf(sql, selfId, now), now)
  const ranked = yield* withMainArt(sql, [...found.filter((pick) => pick.kind === 'im').slice(0, PICK_LIMIT), ...found.filter((pick) => pick.kind !== 'im').slice(0, PICK_LIMIT)])
  return {
    recent: [],
    people: ranked.filter((pick) => pick.kind === 'im'),
    channels: ranked.filter((pick) => pick.kind !== 'im'),
  } satisfies PickConversations
})



/** Indexed own-message range used by ⌘K's ranking, also checked by the plan gate. */
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
 * each week, then by activity. With text, the conversations the destination
 * list finds for it, by how well they match, then ranked the same way
 * (`rankSearchResults`), and after them the public channels you are not in
 * that match, ranked the same way. Local only.
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
    return yield* withMainArt(sql, chosen.map((row) => pickOf(row, users, selfId)))
  }
  const ranked = yield* rankFound(sql, yield* searchEntries(text), uses, now)
  // Public channels you are not in come after yours, in their own rank order (SPEC 10).
  const joinedFirst = [...ranked.filter((pick) => pick.notJoined !== true), ...ranked.filter((pick) => pick.notJoined === true)]
  return yield* withMainArt(sql, joinedFirst.slice(0, PALETTE_CONVERSATIONS))
})
