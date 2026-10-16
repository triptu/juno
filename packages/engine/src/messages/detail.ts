/**
 * `topics.get` and `channel.threads`: the topic header and Main's list of
 * active threads. Both read `topic_index` by key or by the channel index
 * and shape with the same domain rules as the sidebar (`topicRows.ts`).
 */
import {
  hashId,
  isFollowed,
  isResolved,
  quietDaysOf,
  mentionedUserIds,
  resolveTitle,
  topicStatus,
  tsToMillis,
  type ChannelId,
  type Topic,
  type Ts,
} from '@juno/domain'
import type { Person, ThreadSummary, TopicDetail } from '@juno/contract'
import { StoreReader, type SqlClient, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { ListRun } from '../protocol/live'
import {
  artRefOf,
  channelInfoOf,
  channelRefOf,
  parseColumns,
  parseIds,
  personFrom,
  topicFrom,
  TOPIC_COLUMNS,
  TOPIC_FROM,
  userIdsOf,
  userName,
  type JoinedRow,
  type UserRow,
} from '../topicRows'
import { threadsStatements } from './window'
import type { WindowTarget } from './window'

const DAY = 24 * 60 * 60 * 1000

/** The quiet window from prefs, clamped by the domain rule, and the signed-in user. */
const settings = (sql: SqlClient.SqlClient, now: number) =>
  Effect.gen(function* () {
    const prefs = yield* sql<{ key: string; value_json: string }>`SELECT key, value_json FROM prefs WHERE key IN ('quietDays', 'aiAssist')`
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const raw = (key: string): unknown => {
      const row = prefs.find((entry) => entry.key === key)
      return row === undefined ? undefined : (JSON.parse(row.value_json) as unknown)
    }
    const quietDays = raw('quietDays')
    const ctx = { now, ...(typeof quietDays === 'number' ? { quietDays } : {}) }
    const cutoff = `${Math.floor((now - quietDaysOf(ctx) * DAY) / 1000)}.000000`
    return { ctx, cutoff, aiAssist: raw('aiAssist') !== false, selfId: team[0]?.self_user_id ?? undefined }
  })

const readUsers = (sql: SqlClient.SqlClient, ids: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const users = new Map<string, UserRow>()
    if (ids.size === 0) return users
    for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...ids])}`) users.set(user.id, user)
    return users
  })

/**
 * The joined row of a topic the index does not hold yet (a Main with no
 * stored message, a thread opened from a link before its replies are
 * stored): the conversation, the overlay and the follow flag, with empty
 * activity. `undefined` when the conversation is unknown too.
 */
const bareRow = (sql: SqlClient.SqlClient, id: string, target: WindowTarget) =>
  Effect.gen(function* () {
    const rootTs = target.kind === 'thread' ? target.threadTs : null
    const rows = yield* sql<JoinedRow>`
      SELECT ${id} AS topic_id, c.id AS channel, ${target.kind} AS kind, NULL AS last_activity_ts, 0 AS message_count,
        '[]' AS participants_json, ${rootTs} AS root_ts, 0 AS unread_count, 1 AS unread_exact, 0 AS mentions_me, NULL AS preview_json, 0 AS rev,
        c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members,
        o.manual_title, o.ai_title, o.resolved_at, o.resolved_activity_ts, o.reopened_at, o.pinned_at,
        s.subscribed AS subscribed, a.recipe AS art_recipe, a.status AS art_status, NULL AS channel_activity_ts
      FROM conversations c
      LEFT JOIN topic_art a ON a.topic_id = ${id}
      LEFT JOIN topic_overlay o ON o.topic_id = ${id}
      LEFT JOIN thread_subs s ON s.channel = c.id AND s.thread_ts = ${rootTs ?? ''}
      WHERE c.id = ${target.channel}`
    const row = rows[0]
    if (row === undefined || target.kind !== 'thread') return row
    // The root's text, when it is stored, gives the fallback title.
    const root = yield* sql<{ text: string; deleted: 0 | 1 }>`SELECT text, deleted FROM messages WHERE channel = ${target.channel} AND ts = ${target.threadTs}`
    const text = root[0] !== undefined && root[0].deleted === 0 && root[0].text !== '' ? root[0].text.slice(0, 240) : undefined
    return text === undefined ? row : { ...row, preview_json: JSON.stringify({ sender: '', text: '', rootText: text }) }
  })

/** The header of one topic; `null` when neither the topic nor its conversation is known. */
export const topicDetail = (id: string, target: WindowTarget, now: number): Effect.Effect<TopicDetail | null, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { ctx, cutoff, aiAssist, selfId } = yield* settings(sql, now)
    const indexed = yield* sql.unsafe<JoinedRow>(`${TOPIC_COLUMNS}, NULL AS channel_activity_ts ${TOPIC_FROM} WHERE i.topic_id = ?`, [id])
    if (id.startsWith('p:') && indexed[0] === undefined) return null
    const row = indexed[0] ?? (yield* bareRow(sql, id, target))
    if (row === undefined) return null
    const columns = parseColumns(row)
    const ids = new Set<string>()
    userIdsOf(row, columns, ids)
    const users = yield* readUsers(sql, ids)
    const nameOf = (userId: string) => userName(userId, users.get(userId))
    const info = channelInfoOf(row, columns, selfId, nameOf)
    const topic = topicFrom(row, columns, info)
    const partnerId = row.c_kind === 'im' ? (row.c_user_id ?? undefined) : undefined
    const { partnerId: _partnerId, ...channel } = channelRefOf(info, partnerId)
    const reads = yield* sql<{ last_read_ts: string | null }>`SELECT last_read_ts FROM topic_reads WHERE topic_id = ${id}`
    const lastReadTs = reads[0]?.last_read_ts ?? undefined
    const title = resolveTitle(topic, { user: nameOf })
    const status = topicStatus(topic, ctx)
    const art = artRefOf(row, aiAssist)
    let threadCount: number | undefined
    if (target.kind === 'main') {
      const count = threadsStatements(target.channel, cutoff, 0).count
      threadCount = (yield* sql.unsafe<{ n: number }>(count.sql, count.params))[0]?.n ?? 0
    }
    return {
      id,
      kind: topic.kind,
      title: title.text,
      titleSource: title.source,
      channel: partnerId === undefined ? channel : { ...channel, partner: personFrom(partnerId, users.get(partnerId)) },
      status: status === 'ignored' ? 'open' : status,
      subscribed: isFollowed(topic),
      pinned: topic.overlay.pinnedAt !== undefined,
      resolved: isResolved(topic),
      messageCount: topic.activity.messageCount,
      unreadCount: topic.activity.unreadCount,
      unreadExact: topic.activity.unreadExact !== false,
      mentionsMe: topic.activity.mentionsMe,
      ...(lastReadTs === undefined ? {} : { lastReadTs }),
      ...(row.last_activity_ts === null ? {} : { lastActivityTs: row.last_activity_ts }),
      ...(target.kind === 'thread' ? { rootTs: target.threadTs } : {}),
      ...(threadCount === undefined ? {} : { threadCount }),
      ...(art === undefined || art.recipe === '' ? {} : { art: art.recipe }),
    }
  })

interface ThreadRow {
  readonly topic_id: string
  readonly root_ts: string
  readonly last_activity_ts: string
  readonly message_count: number
  readonly unread_count: number
  readonly unread_exact: 0 | 1
  readonly mentions_me: 0 | 1
  readonly participants_json: string | null
  readonly preview_json: string | null
  readonly rev: number
  readonly manual_title: string | null
  readonly ai_title: string | null
  readonly resolved: 0 | 1
}

const THREAD_PARTICIPANTS = 3

/**
 * A channel's threads with activity inside the quiet window, newest first, with their participants as refs.
 * With `all`, every thread the store knows, the resolved ones last (the header's topic switcher).
 */
export const channelThreads = (channel: string, limit: number, now: number, all = false): Effect.Effect<ListRun<ThreadSummary>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { cutoff } = yield* settings(sql, now)
    const statements = threadsStatements(channel, all ? undefined : cutoff, limit)
    const rows = yield* sql.unsafe<ThreadRow>(statements.list.sql, statements.list.params)
    const total = rows.length < limit ? rows.length : ((yield* sql.unsafe<{ n: number }>(statements.count.sql, statements.count.params))[0]?.n ?? rows.length)
    const conversation = (yield* sql<{ kind: Topic['channel']['kind']; name: string | null }>`SELECT kind, name FROM conversations WHERE id = ${channel}`)[0]
    const participants = new Map<string, ReadonlyArray<string>>()
    const ids = new Set<string>()
    const rootTexts = new Map<string, string | undefined>()
    for (const row of rows) {
      const list = parseIds(row.participants_json).slice(0, THREAD_PARTICIPANTS)
      participants.set(row.topic_id, list)
      for (const id of list) ids.add(id)
      const rootText = (() => {
        try {
          return row.preview_json === null ? undefined : (JSON.parse(row.preview_json) as { rootText?: string }).rootText
        } catch {
          return undefined
        }
      })()
      rootTexts.set(row.topic_id, rootText)
      // The people a fallback title mentions, so it reads "@Maya …".
      for (const id of mentionedUserIds(rootText)) ids.add(id)
    }
    const users = yield* readUsers(sql, ids)
    const summaries: Array<ThreadSummary> = rows.map((row) => {
      const rootText = rootTexts.get(row.topic_id)
      const topic: Topic = {
        id: row.topic_id as Topic['id'],
        kind: 'thread',
        channel: { id: channel as ChannelId, kind: conversation?.kind ?? 'public', name: conversation?.name ?? channel },
        activity: { lastActivityTs: row.last_activity_ts as Ts, messageCount: row.message_count, unreadCount: row.unread_count, mentionsMe: row.mentions_me === 1, participants: [] },
        overlay: {
          ...(row.manual_title === null ? {} : { manualTitle: row.manual_title }),
          ...(row.ai_title === null ? {} : { aiTitle: row.ai_title }),
        },
        ...(rootText === undefined ? {} : { firstMessageText: rootText }),
      }
      const title = resolveTitle(topic, { user: (id) => userName(id, users.get(id)) })
      const fields: Omit<ThreadSummary, 'rev'> = {
        id: row.topic_id,
        rootTs: row.root_ts,
        title: title.text,
        titleSource: title.source,
        replyCount: Math.max(0, row.message_count - 1),
        lastActivityTs: row.last_activity_ts,
        lastActivityAt: tsToMillis(row.last_activity_ts as Ts),
        unreadCount: row.unread_count,
        unreadExact: row.unread_exact === 1,
        mentionsMe: row.mentions_me === 1,
        participantIds: participants.get(row.topic_id) ?? [],
        ...(row.resolved === 1 ? { resolved: true } : {}),
      }
      return { ...fields, rev: hashId(JSON.stringify(fields)) }
    })
    const people: Array<Person> = [...ids].map((id) => personFrom(id, users.get(id)))
    return { rows: summaries, total, refs: { people } }
  })
