/**
 * The @ and # suggestions' queries (spec section 8, inventory 7.1). Local
 * only: they read the people, conversations, messages and topics the sync
 * stored. The statements that read `messages` and `topic_index` are in
 * `mentionStatements`, so the plan test can check each one reads them
 * through an index (performance 6).
 */
import type { MentionChannel, MentionPerson } from '@juno/contract'
import { defaultPersonColor, rankSuggestions } from '@juno/domain'
import { ftsQuery, StoreReader } from '@juno/store'
import { Clock, Effect } from 'effect'
import { parseIds } from '../topicRows'

/** How many of a channel's latest messages say who is in the conversation. */
const RECENT_MESSAGES = 500
/** How many recent DMs and group DMs name the recent contacts. */
const RECENT_CONTACT_CONVERSATIONS = 30
/** How many people or channels a search reads before ranking. */
const SEARCH_LIMIT = 40
/** How far back recent contacts and channel activity look. */
const RECENT_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

/** Seconds as a Slack ts, for comparing with `last_activity_ts`. */
const cutoffTs = (now: number) => `${Math.floor((now - RECENT_DAYS * DAY) / 1000)}.000000`

interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<string | number>
}

/** Activity per conversation over the last `RECENT_DAYS`, through the activity index. */
const ACTIVITY = `SELECT channel, MAX(last_activity_ts) AS activity FROM topic_index INDEXED BY topic_index_activity WHERE last_activity_ts > ? GROUP BY channel`

/** The statements that read `messages` and `topic_index`. */
export const mentionStatements = {
  /** Who posted in a thread, latest first. */
  threadPosters: (channel: string, threadTs: string): Statement => ({
    sql: `SELECT user_id, MAX(ts) AS at FROM messages WHERE channel = ? AND thread_ts = ? AND deleted = 0 AND user_id IS NOT NULL GROUP BY user_id ORDER BY at DESC`,
    params: [channel, threadTs],
  }),
  /** Who posted among a conversation's latest messages, latest first. */
  channelPosters: (channel: string): Statement => ({
    sql: `SELECT user_id, MAX(ts) AS at FROM (SELECT user_id, ts FROM messages WHERE channel = ? AND deleted = 0 ORDER BY ts DESC LIMIT ?)
      WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY at DESC`,
    params: [channel, RECENT_MESSAGES],
  }),
  /** Your DMs and group DMs by latest activity. */
  recentContacts: (cutoff: string): Statement => ({
    sql: `SELECT c.user_id, c.kind, c.member_ids_json FROM conversations c JOIN (${ACTIVITY}) a ON a.channel = c.id
      WHERE c.kind IN ('im', 'mpim') ORDER BY a.activity DESC, c.id LIMIT ?`,
    params: [cutoff, RECENT_CONTACT_CONVERSATIONS],
  }),
  /** The channels you are in, by latest activity, then by name. */
  yourChannels: (cutoff: string): Statement => ({
    sql: `SELECT c.id, c.name, c.kind, c.is_member FROM conversations c LEFT JOIN (${ACTIVITY}) a ON a.channel = c.id
      WHERE c.kind IN ('public', 'private') AND c.is_member = 1 AND c.is_archived = 0 AND c.name IS NOT NULL
      ORDER BY a.activity IS NULL, a.activity DESC, c.name LIMIT ?`,
    params: [cutoff, SEARCH_LIMIT],
  }),
}

interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_small_url?: string | null
  readonly avatar_url: string | null
  readonly deleted: 0 | 1
}

const USER_COLUMNS = 'u.id, u.name, u.display_name, u.real_name, u.avatar_url, u.avatar_small_url, u.avatar_large_url, u.deleted'

/** The name the token shows: the display name, as message chips show it. */
const shownName = (user: UserRow) => user.display_name || user.real_name || user.name || user.id

function personOf(user: UserRow, tier: number, order: number): MentionPerson {
  const name = shownName(user)
  const realName = user.real_name && user.real_name !== name ? user.real_name : undefined
  return {
    id: user.id,
    name,
    ...(realName === undefined ? {} : { realName }),
    ...(user.avatar_url ? { avatarUrl: user.avatar_small_url || user.avatar_url } : {}),
    color: defaultPersonColor(user.id),
    tier,
    order,
    names: [name, ...(user.real_name ? [user.real_name] : []), ...(user.name ? [user.name] : [])],
  }
}

/** The people matching `text` for a composer in `channel` (and `threadTs`), ranked (see `mentions.people`). */
export const queryPeople = Effect.fn('mentions.people')(function* (channel: string | undefined, threadTs: string | undefined, text: string) {
  const sql = yield* StoreReader
  const now = yield* Clock.currentTimeMillis
  const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined

  // Tier 0: the conversation. Tier 1: recent contacts. The first place a person is seen wins.
  const tierOf = new Map<string, { readonly tier: number; readonly order: number }>()
  const add = (id: string | null, tier: number) => {
    if (id === null || id === selfId || tierOf.has(id)) return
    tierOf.set(id, { tier, order: tierOf.size })
  }
  if (channel !== undefined) {
    const statements = [...(threadTs === undefined ? [] : [mentionStatements.threadPosters(channel, threadTs)]), mentionStatements.channelPosters(channel)]
    for (const statement of statements) for (const row of yield* sql.unsafe<{ user_id: string }>(statement.sql, statement.params)) add(row.user_id, 0)
    const conversation = (yield* sql<{ user_id: string | null; member_ids_json: string | null }>`SELECT user_id, member_ids_json FROM conversations WHERE id = ${channel}`)[0]
    add(conversation?.user_id ?? null, 0)
    for (const id of parseIds(conversation?.member_ids_json ?? null)) add(id, 0)
  }
  const contacts = mentionStatements.recentContacts(cutoffTs(now))
  for (const row of yield* sql.unsafe<{ user_id: string | null; member_ids_json: string | null }>(contacts.sql, contacts.params)) {
    add(row.user_id, 1)
    for (const id of parseIds(row.member_ids_json)) add(id, 1)
  }
  const known = [...tierOf.keys()]
  const users = known.length === 0 ? [] : yield* sql<UserRow>`SELECT ${sql.literal(USER_COLUMNS)} FROM users u WHERE u.id IN ${sql.in(known)}`

  // Tier 2: everyone else the query matches, or the first few by name with no query.
  const terms = ftsQuery(text.trim())
  const everyone =
    terms === ''
      ? yield* sql<UserRow>`SELECT ${sql.literal(USER_COLUMNS)} FROM users u WHERE u.deleted = 0 AND u.is_bot = 0 ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.real_name, u.name)) LIMIT ${SEARCH_LIMIT}`
      : yield* sql<UserRow>`SELECT ${sql.literal(USER_COLUMNS)} FROM people_fts f JOIN users u ON u.rowid = f.rowid
          WHERE people_fts MATCH ${`${terms}*`} AND u.deleted = 0 ORDER BY f.rank, u.id LIMIT ${SEARCH_LIMIT}`

  const people: MentionPerson[] = []
  for (const user of users) {
    const place = tierOf.get(user.id)
    if (place !== undefined && user.deleted === 0) people.push(personOf(user, place.tier, place.order))
  }
  everyone.forEach((user, index) => {
    if (!tierOf.has(user.id) && user.id !== selfId) people.push(personOf(user, 2, index))
  })
  return rankSuggestions(people, text)
})

interface ChannelRow {
  readonly id: string
  readonly name: string
  readonly kind: 'public' | 'private'
  readonly is_member: 0 | 1
}

/** The channels matching `text`, yours first (see `mentions.channels`). */
export const queryChannels = Effect.fn('mentions.channels')(function* (text: string) {
  const sql = yield* StoreReader
  const terms = ftsQuery(text.trim())
  let rows: ReadonlyArray<ChannelRow>
  if (terms === '') {
    const yours = mentionStatements.yourChannels(cutoffTs(yield* Clock.currentTimeMillis))
    rows = yield* sql.unsafe<ChannelRow>(yours.sql, yours.params)
  } else {
    rows = yield* sql<ChannelRow>`SELECT c.id, c.name, c.kind, c.is_member FROM channels_fts f JOIN conversations c ON c.rowid = f.rowid
      WHERE channels_fts MATCH ${`${terms}*`} AND c.kind IN ('public', 'private') AND c.is_archived = 0 AND c.name IS NOT NULL
      ORDER BY f.rank, c.id LIMIT ${SEARCH_LIMIT}`
  }
  const channels = rows.map(
    (row, index): MentionChannel => ({ id: row.id, name: row.name, kind: row.kind, tier: row.is_member === 1 ? 0 : 1, order: index, names: [row.name] }),
  )
  return rankSuggestions(channels, text)
})
