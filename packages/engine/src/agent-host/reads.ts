/**
 * The agent's Slack and topic reads, from the local store (architecture 10,
 * plan v3 §9 Tier 0). Reads never call Slack: the sync keeps the store
 * current, and a read must not spend the request budget. Text is returned
 * whole and as stored; the agent treats it as untrusted.
 *
 * Pages: history is newest first by page, each page in time order, with
 * `next` the oldest `ts` to read before. Replies run from the root forward,
 * `next` the last `ts`. Search and the topic list page by offset.
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
import { ftsQuery, StoreReader, type SqlClient } from '@juno/store'
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

/** A channel the owner sees in Juno: a member, and not ignored. */
const VISIBLE = 'c.is_member = 1 AND NOT EXISTS (SELECT 1 FROM ignored_channels g WHERE g.channel = c.id)'

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

/** A search split into its words and Slack's `from:` and `in:` modifiers. */
export interface ParsedSearch {
  readonly text: string
  readonly from: ReadonlyArray<string>
  readonly in: ReadonlyArray<string>
}

/** `from:@maya`, `from:<@U1>`, `from:U1`, `from:me` (the signed-in user), `in:#eng`, `in:<#C1|eng>`, `in:C1`; everything else is text. */
export function parseSearch(query: string): ParsedSearch {
  const words: Array<string> = []
  const from: Array<string> = []
  const into: Array<string> = []
  for (const token of query.split(/\s+/).filter((t) => t.length > 0)) {
    const modifier = /^(from|in):(.+)$/i.exec(token)
    if (modifier === null) {
      words.push(token)
      continue
    }
    const value = modifier[2]!.replace(/^<[@#]([^|>]+)(?:\|[^>]*)?>$/, '$1').replace(/^[@#]/, '')
    if (modifier[1]!.toLowerCase() === 'from') from.push(value)
    else into.push(value)
  }
  return { text: words.join(' '), from, in: into }
}

const lower = (values: ReadonlyArray<string>) => values.map((v) => v.toLowerCase())

/** Ids for names or ids; `undefined` when there was no modifier, empty when it names nobody. */
const resolveIds = (sql: SqlClient.SqlClient, kind: 'users' | 'conversations', values: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (values.length === 0) return undefined
    const names = lower(values)
    const marks = names.map(() => '?').join(', ')
    const columns = kind === 'users' ? ['lower(name)', 'lower(display_name)', 'lower(real_name)'] : ['lower(name)']
    const rows = yield* sql.unsafe<{ id: string }>(
      `SELECT id FROM ${kind} WHERE id IN (${values.map(() => '?').join(', ')}) OR ${columns.map((c) => `${c} IN (${marks})`).join(' OR ')}`,
      [...values, ...columns.flatMap(() => names)],
    )
    return rows.map((r) => r.id)
  })

export const search = (query: string, offsetCursor: string | undefined, limit: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const parsed = parseSearch(query)
    const [team] = parsed.from.some((name) => name.toLowerCase() === 'me') ? yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1` : []
    const from = yield* resolveIds(sql, 'users', parsed.from.map((name) => (name.toLowerCase() === 'me' ? (team?.self_user_id ?? name) : name)))
    const into = yield* resolveIds(sql, 'conversations', parsed.in)
    const terms = ftsQuery(parsed.text)
    const offset = Math.max(0, Number(offsetCursor ?? 0) || 0)
    if (from?.length === 0 || into?.length === 0 || (terms === '' && from === undefined && into === undefined)) return { messages: [] } satisfies MessagePage
    const where: Array<string> = ['m.deleted = 0', VISIBLE]
    const params: Array<unknown> = []
    if (terms !== '') {
      where.push('messages_fts MATCH ?')
      params.push(terms)
    }
    if (from !== undefined) {
      where.push(`m.user_id IN (${from.map(() => '?').join(', ')})`)
      params.push(...from)
    }
    if (into !== undefined) {
      where.push(`m.channel IN (${into.map(() => '?').join(', ')})`)
      params.push(...into)
    }
    const source = terms === '' ? 'messages m' : 'messages_fts f JOIN messages m ON m.rowid = f.rowid'
    const rows = yield* sql.unsafe<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM ${source} JOIN conversations c ON c.id = m.channel
       WHERE ${where.join(' AND ')} ORDER BY ${terms === '' ? '' : 'f.rank, '}m.ts DESC LIMIT ? OFFSET ?`,
      [...params, limit + 1, offset],
    )
    return { messages: yield* named(sql, rows.slice(0, limit)), ...(rows.length > limit ? { next: cursor(String(offset + limit)) } : {}) } satisfies MessagePage
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
