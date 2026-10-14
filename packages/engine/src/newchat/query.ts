/**
 * The New chat pickers' queries (spec section 9). Local only: they read the
 * conversations, people and topics the sync stored. The statements that
 * read `topic_index` are in `pickerStatements`, so the plan test can check
 * that each one reads it through an index (performance 6).
 */
import { PICK_LIMIT, RECENT_CONVERSATIONS, type PickConversation, type PickConversations, type PickThread } from '@juno/contract'
import { channelLabelBare, contextTint, firstWords, mainTopicId, tsToMillis, type ChannelId, type ConversationKind, type Ts } from '@juno/domain'
import { ftsQuery, StoreReader, type SqlClient } from '@juno/store'
import { Clock, Effect } from 'effect'
import { parseIds, personFrom, userName, type UserRow } from '../topicRows'

/** A conversation row with whether Juno holds any of its messages. */
interface ConversationRow {
  readonly id: string
  readonly kind: ConversationKind
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
  readonly has_topics: 0 | 1
}

const CONVERSATION_COLUMNS = `c.id, c.kind, c.name, c.user_id, c.member_ids_json,
  EXISTS (SELECT 1 FROM topic_index t WHERE t.channel = c.id) AS has_topics`

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
    const rows = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of rows) users.set(row.id, row)
    return users
  })

const selfIdOf = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`, (rows) => rows[0]?.self_user_id ?? undefined)

/** The people a set of conversation rows names: DM partners and group DM members. */
function peopleOf(rows: ReadonlyArray<ConversationRow>): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.user_id !== null) ids.add(row.user_id)
    if (row.kind === 'mpim') for (const id of parseIds(row.member_ids_json)) ids.add(id)
  }
  return ids
}

function pickOf(row: ConversationRow, users: ReadonlyMap<string, UserRow>, selfId: string | undefined): PickConversation {
  const base = { key: row.id, kind: row.kind, tint: contextTint(row.kind), channelId: row.id, mainId: mainTopicId(row.id as ChannelId), empty: row.has_topics === 0 }
  switch (row.kind) {
    case 'im': {
      const userId = row.user_id ?? row.id
      const person = personFrom(userId, users.get(userId))
      return { ...base, name: person.name, person }
    }
    case 'mpim': {
      const memberNames = parseIds(row.member_ids_json)
        .filter((id) => id !== selfId)
        .map((id) => userName(id, users.get(id)))
      return { ...base, name: channelLabelBare({ id: row.id as ChannelId, kind: 'mpim', name: row.name ?? row.id, memberNames }) }
    }
    default:
      return { ...base, name: row.name ?? row.id }
  }
}

/** A person with no DM yet: sending opens one. */
const newPerson = (user: UserRow): PickConversation => ({
  key: `u:${user.id}`,
  name: userName(user.id, user),
  kind: 'im',
  tint: 'dm',
  person: personFrom(user.id, user),
  empty: true,
})

/** The conversation picker's sections for `text` (see `newChat.conversations`). */
export const queryConversations = Effect.fn('newChat.conversations')(function* (text: string) {
  const sql = yield* StoreReader
  const selfId = yield* selfIdOf(sql)
  const terms = ftsQuery(text.trim())
  if (terms === '') {
    const { recent } = pickerStatements(cutoffTs(yield* Clock.currentTimeMillis), undefined, undefined)
    const rows = yield* sql.unsafe<ConversationRow>(recent.sql, recent.params)
    const users = yield* readUsers(sql, peopleOf(rows))
    return { recent: rows.map((row) => pickOf(row, users, selfId)), people: [], channels: [] } satisfies PickConversations
  }
  // Only the last word is a prefix, matching an input still being typed.
  const query = `${terms}*`
  const people = yield* sql<UserRow>`SELECT u.id, u.name, u.display_name, u.real_name, u.avatar_url
    FROM people_fts f JOIN users u ON u.rowid = f.rowid
    WHERE people_fts MATCH ${query} AND u.deleted = 0 AND u.is_bot = 0 ORDER BY f.rank, u.id LIMIT ${PICK_LIMIT}`
  const dms =
    people.length === 0
      ? []
      : yield* sql.unsafe<ConversationRow>(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations c WHERE c.kind = 'im' AND c.user_id IN (${people.map(() => '?').join(', ')})`,
          people.map((person) => person.id),
        )
  const channels = yield* sql.unsafe<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM channels_fts f
      JOIN conversations c ON c.rowid = f.rowid LEFT JOIN ignored_channels g ON g.channel = c.id
      WHERE channels_fts MATCH ? AND c.kind != 'im' AND c.is_member = 1 AND g.channel IS NULL ORDER BY f.rank, c.id LIMIT ?`,
    [query, PICK_LIMIT],
  )
  const users = yield* readUsers(sql, new Set([...peopleOf(channels), ...people.map((person) => person.id)]))
  for (const person of people) users.set(person.id, person)
  const dmOf = new Map(dms.map((row) => [row.user_id, row]))
  return {
    recent: [],
    people: people.map((person) => {
      const dm = dmOf.get(person.id)
      return dm === undefined ? newPerson(person) : pickOf(dm, users, selfId)
    }),
    channels: channels.map((row) => pickOf(row, users, selfId)),
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
