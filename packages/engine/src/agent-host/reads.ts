/**
 * The agent's Slack and topic reads, from the local store (architecture 10,
 * plan v3 §9 Tier 0). Search lives in search.ts and also reads Slack.
 * These reads return cached text whole and as stored; the agent treats it as untrusted.
 *
 * Pages: history is newest first by page, each page in time order, with
 * `next` the oldest `ts` to read before. Replies run from the root forward,
 * `next` the last `ts`. The topic list pages by offset.
 */
import {
  channelKindLabel,
  channelLabel,
  type ConversationKind,
  channelLabelBare,
  contextTint,
  isResolved,
  mainLabel,
  resolveTitle,
  type ChannelInfo,
} from '@juno/domain'
import { StoreReader, type SqlClient } from '@juno/store'
import { Effect } from 'effect'
import { AgentHostError, HostChannelId, HostCursor, type HostUserId, type Place, type TopicLink } from '@juno/agent-contract'
import type { Message, MessagePage, Topic } from '@juno/agent-juno'
import { channelInfoOf, parseColumns, parseIds, TOPIC_COLUMNS, TOPIC_FROM, topicFrom, userName, type JoinedRow, type UserRow } from '../topicRows'

type Cursor = typeof HostCursor.Type
const cursor = (value: string): Cursor => value as Cursor

interface MessageRow {
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly user_id: string | null
  readonly text: string
  readonly edited_ts: string | null
  readonly client_msg_id: string | null
}

const MESSAGE_COLUMNS = 'm.channel, m.ts, m.thread_ts, m.user_id, m.text, m.edited_ts, m.client_msg_id'

/** A message without a user (a bot or an integration) has an empty sender. */
export const toMessage = (row: MessageRow): Message =>
  ({
    channelId: row.channel,
    ts: row.ts,
    ...(row.thread_ts !== null && row.thread_ts !== row.ts ? { threadTs: row.thread_ts } : {}),
    senderId: row.user_id ?? '',
    text: row.text,
    ...(row.edited_ts === null ? {} : { editedAt: row.edited_ts }),
    ...(row.client_msg_id === null ? {} : { clientMessageId: row.client_msg_id }),
  }) as Message

const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => '?').join(', ')

interface ConversationRow {
  readonly id: string
  readonly kind: ConversationKind
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
}

/** The messages with the sender's and the channel's names, as Juno's rows show them. */
const named = (sql: SqlClient.SqlClient, rows: ReadonlyArray<MessageRow>) =>
  Effect.gen(function* () {
    const channelIds = [...new Set(rows.map((r) => r.channel))]
    const conversations = channelIds.length === 0
      ? []
      : yield* sql.unsafe<ConversationRow>(`SELECT id, kind, name, user_id, member_ids_json FROM conversations WHERE id IN (${placeholders(channelIds)})`, channelIds)
    const [team] = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const members = (c: ConversationRow) => (c.kind === 'mpim' ? parseIds(c.member_ids_json).filter((id) => id !== team?.self_user_id) : [])
    const userIds = [...new Set([
      ...rows.flatMap((r) => (r.user_id ? [r.user_id] : [])),
      ...conversations.flatMap((c) => [...(c.user_id ? [c.user_id] : []), ...members(c)]),
    ])]
    const users = userIds.length === 0
      ? []
      : yield* sql.unsafe<UserRow>(`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN (${placeholders(userIds)})`, userIds)
    const byId = new Map(users.map((u) => [u.id, u]))
    const nameOf = (id: string) => userName(id, byId.get(id))
    const channelNames = new Map(conversations.map((c) => [c.id, channelLabel({
      kind: c.kind,
      name: c.kind === 'im' && c.user_id !== null ? nameOf(c.user_id) : (c.name ?? c.id),
      memberNames: members(c).map(nameOf),
    })]))
    return rows.map((row): Message => {
      const channelName = channelNames.get(row.channel)
      return { ...toMessage(row), ...(row.user_id ? { senderName: nameOf(row.user_id) } : {}), ...(channelName ? { channelName } : {}) }
    })
  })

const notFound = (message: string) => new AgentHostError({ reason: 'notFound', message })

export const history = (channelId: string, before: string | undefined, limit: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql.unsafe<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
       WHERE m.channel = ? AND m.deleted = 0 AND (m.thread_ts IS NULL OR m.thread_ts = m.ts) ${before === undefined ? '' : 'AND m.ts < ?'}
       ORDER BY m.ts DESC LIMIT ?`,
      before === undefined ? [channelId, limit + 1] : [channelId, before, limit + 1],
    )
    const page = rows.slice(0, limit).toReversed()
    return { messages: yield* named(sql, page), ...(rows.length > limit && page[0] ? { next: cursor(page[0].ts) } : {}) } satisfies MessagePage
  })

export const replies = (channelId: string, threadTs: string, after: string | undefined, limit: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql.unsafe<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
       WHERE m.channel = ? AND (m.ts = ? OR m.thread_ts = ?) AND m.deleted = 0 ${after === undefined ? '' : 'AND m.ts > ?'}
       ORDER BY m.ts ASC LIMIT ?`,
      after === undefined ? [channelId, threadTs, threadTs, limit + 1] : [channelId, threadTs, threadTs, after, limit + 1],
    )
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return { messages: yield* named(sql, page), ...(rows.length > limit && last ? { next: cursor(last.ts) } : {}) } satisfies MessagePage
  })

export const person = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [row] = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id = ${userId}`
    if (row === undefined) return yield* notFound('No such person.')
    return { id: row.id as typeof HostUserId.Type, name: row.real_name ?? row.name ?? row.id, displayName: userName(row.id, row) }
  })

const TOPIC_SELECT = `${TOPIC_COLUMNS}, NULL AS channel_activity_ts ${TOPIC_FROM}`

/** Turns joined rows into topic links, the place and whether each is resolved. */
const shape = (sql: SqlClient.SqlClient, rows: ReadonlyArray<JoinedRow>) =>
  Effect.gen(function* () {
    const ids = new Set<string>()
    const parsed = rows.map((row) => {
      const columns = parseColumns(row)
      for (const id of columns.members) ids.add(id)
      if (row.c_user_id !== null) ids.add(row.c_user_id)
      return { row, columns }
    })
    const users = ids.size === 0 ? [] : yield* sql.unsafe<UserRow>(`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN (${[...ids].map(() => '?').join(', ')})`, [...ids])
    const byId = new Map(users.map((u) => [u.id, u]))
    const [team] = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const nameOf = (id: string) => userName(id, byId.get(id))
    return parsed.map(({ row, columns }) => {
      const channel: ChannelInfo = channelInfoOf(row, columns, team?.self_user_id ?? undefined, nameOf)
      const topic = topicFrom(row, columns, channel)
      const link: TopicLink = {
        topicId: row.topic_id,
        title: row.kind === 'main' ? mainLabel(channel) : resolveTitle(topic).text,
        where: channelLabel(channel),
        tint: contextTint(channel.kind),
      }
      const place: Place = { channelId: row.channel, name: channelLabelBare(channel), kindLabel: channelKindLabel(channel.kind), tint: contextTint(channel.kind) }
      return { link, place, resolved: isResolved(topic), row }
    })
  })

/** Open topics, most recent activity first. Resolved topics are left out. */
export const topics = (offsetCursor: string | undefined, limit: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const offset = Math.max(0, Number(offsetCursor ?? 0) || 0)
    const rows = yield* sql.unsafe<JoinedRow>(
      `${TOPIC_SELECT} WHERE i.kind IN ('thread', 'main') AND ig.channel IS NULL AND c.is_member = 1
       ORDER BY i.last_activity_ts DESC, i.topic_id LIMIT ? OFFSET ?`,
      [limit + 1, offset],
    )
    const shaped = yield* shape(sql, rows.slice(0, limit))
    return {
      topics: shaped.filter((t) => !t.resolved).map((t) => t.link),
      ...(rows.length > limit ? { next: cursor(String(offset + limit)) } : {}),
    }
  })

export const topicLink = (topicId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql.unsafe<JoinedRow>(`${TOPIC_SELECT} WHERE i.topic_id = ?`, [topicId])
    const [shaped] = yield* shape(sql, rows)
    return shaped
  })

export const topic = (topicId: string) =>
  Effect.gen(function* () {
    const shaped = yield* topicLink(topicId)
    if (shaped === undefined) return yield* notFound('No such topic.')
    const { row } = shaped
    const messages = row.kind === 'thread' && row.root_ts !== null ? yield* replies(row.channel, row.root_ts, undefined, 50) : yield* history(row.channel, undefined, 50)
    return { topic: shaped.link, place: shaped.place, resolved: shaped.resolved, messages } satisfies Topic
  })

/** Directory lookup: match channel names without reading any Slack message content. */
export const channels = (pattern: string, cursor: string | undefined, limit: number) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const glob = pattern.toLowerCase().replaceAll('[', '[[]')
  const rows = yield* sql<{ id: string; name: string }>`SELECT id, name FROM conversations
    WHERE kind IN ('public', 'private') AND lower(name) GLOB ${glob} AND id > ${cursor ?? ''}
    ORDER BY id LIMIT ${limit + 1}`
  return { channels: rows.slice(0, limit).map((row) => ({ ...row, id: HostChannelId.make(row.id) })),
    ...(rows.length > limit ? { next: HostCursor.make(rows[limit - 1]!.id) } : {}) }
})

interface CountRow {
  readonly channel: string
  readonly thread_ts?: string | null
  readonly user_id: string | null
  readonly n: number
  readonly last: string
}

/**
 * Who the owner exchanged messages with since `since` (ms), most first
 * (SPEC 13.8): in one-to-one DMs, and in threads outside DMs the owner
 * posted in, where every message of another person counts as theirs and
 * the owner's messages count toward each of them. Counts and names only,
 * from the local store; no message text leaves it. Bots, deactivated
 * people and the owner are left out.
 */
export const people = (since: number, limit: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [team] = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const self = team?.self_user_id
    if (self == null) return { people: [] }
    const from = `${Math.max(0, Math.floor(since / 1000))}.000000`
    const tally = new Map<string, { owner: number; them: number; last: number; dm?: string }>()
    const add = (id: string, owner: number, them: number, last: number, dm?: string) => {
      const seen = tally.get(id) ?? { owner: 0, them: 0, last: 0 }
      const channel = dm ?? seen.dm
      tally.set(id, { owner: seen.owner + owner, them: seen.them + them, last: Math.max(seen.last, last), ...(channel === undefined ? {} : { dm: channel }) })
    }
    const ms = (ts: string) => Math.round(Number(ts) * 1000)

    // One-to-one DMs: the owner's messages and the other person's, by DM.
    const dms = yield* sql.unsafe<CountRow & { readonly partner: string }>(
      `SELECT m.channel, c.user_id AS partner, m.user_id, count(*) AS n, max(m.ts) AS last
       FROM messages m JOIN conversations c ON c.id = m.channel
       WHERE c.kind = 'im' AND c.user_id IS NOT NULL AND m.deleted = 0 AND m.ts >= ? GROUP BY m.channel, m.user_id`,
      [from],
    )
    for (const row of dms) {
      if (row.user_id === self) add(row.partner, row.n, 0, ms(row.last), row.channel)
      else if (row.user_id === row.partner) add(row.partner, 0, row.n, ms(row.last), row.channel)
    }

    // Threads outside DMs the owner posted in, newest first, at most 500.
    const threads = yield* sql.unsafe<{ readonly channel: string; readonly thread_ts: string }>(
      `SELECT m.channel, m.thread_ts, max(m.ts) AS last FROM messages m JOIN conversations c ON c.id = m.channel
       WHERE m.user_id = ? AND m.deleted = 0 AND m.ts >= ? AND m.thread_ts IS NOT NULL AND c.kind != 'im'
       GROUP BY m.channel, m.thread_ts ORDER BY last DESC LIMIT 500`,
      [self, from],
    )
    for (let at = 0; at < threads.length; at += 200) {
      const chunk = threads.slice(at, at + 200)
      const rows = yield* sql.unsafe<CountRow>(
        `SELECT channel, thread_ts, user_id, count(*) AS n, max(ts) AS last FROM messages
         WHERE deleted = 0 AND ts >= ? AND (channel, thread_ts) IN (VALUES ${chunk.map(() => '(?, ?)').join(', ')})
         GROUP BY channel, thread_ts, user_id`,
        [from, ...chunk.flatMap((t) => [t.channel, t.thread_ts])],
      )
      const byThread = new Map<string, Array<CountRow>>()
      for (const row of rows) byThread.set(`${row.channel}/${row.thread_ts}`, [...(byThread.get(`${row.channel}/${row.thread_ts}`) ?? []), row])
      for (const group of byThread.values()) {
        const mine = group.find((row) => row.user_id === self)
        for (const row of group) {
          if (row.user_id === null || row.user_id === self) continue
          add(row.user_id, mine?.n ?? 0, row.n, Math.max(ms(row.last), mine === undefined ? 0 : ms(mine.last)))
        }
      }
    }

    const ids = [...tally.keys()].filter((id) => id !== self)
    if (ids.length === 0) return { people: [] }
    const users = yield* sql.unsafe<UserRow & { readonly is_bot: number; readonly deleted: number }>(
      `SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url, is_bot, deleted FROM users WHERE id IN (${placeholders(ids)})`,
      ids,
    )
    const byId = new Map(users.map((user) => [user.id, user]))
    const found = ids.flatMap((id) => {
      const user = byId.get(id)
      const seen = tally.get(id)!
      if (user === undefined || user.is_bot === 1 || user.deleted === 1) return []
      return [{ id: id as typeof HostUserId.Type, name: user.real_name ?? user.name ?? id, owner: seen.owner, them: seen.them, lastAt: seen.last, ...(seen.dm === undefined ? {} : { dm: HostChannelId.make(seen.dm) }) }]
    })
    return { people: found.toSorted((a, b) => b.owner + b.them - (a.owner + a.them) || b.lastAt - a.lastAt).slice(0, limit) }
  })

/** Workspace members for each name: its full, display or handle name, or its first name. Directory metadata only. */
export const members = (names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const answers: Array<{ name: string; ids: Array<{ id: typeof HostUserId.Type; name: string }> }> = []
    for (const name of names) {
      const key = name.trim().toLowerCase()
      const prefix = `${key.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')} %`
      const rows = key === '' ? [] : yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users
        WHERE deleted = 0 AND is_bot = 0
          AND (lower(real_name) = ${key} OR lower(display_name) = ${key} OR lower(name) = ${key} OR lower(real_name) LIKE ${prefix} ESCAPE '\\')
        LIMIT 5`
      answers.push({ name, ids: rows.map((row) => ({ id: row.id as typeof HostUserId.Type, name: row.real_name ?? row.name ?? row.id })) })
    }
    return { members: answers }
  })
