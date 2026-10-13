/**
 * The sidebar query (architecture 4.4, 4.5, performance 6): four indexed
 * lookups on `topic_index`; then the pure rules in `@juno/domain` decide
 * placement, status, title and tags, and the rows are shaped as `TopicRow`.
 *
 * The lookups, each a `SEARCH` (the plan test checks), joined to the
 * overlay, the conversation, the ignored list and Slack's follow flag; the
 * root's text for the fallback title is in the index row itself:
 * 1. the activity window: `last_activity_ts >= cutoff`, newest first, at
 *    most the window size (`topic_index_activity`, or the channel index when
 *    scoped);
 * 2. pinned rows, whatever their age (`topic_overlay_pinned`);
 * 3. rows older than the cutoff that are still unread (`topic_index_unread`);
 * 4. Main rows whose own messages are older than the cutoff but whose
 *    channel has a thread with activity inside it (the window on
 *    `topic_index_activity`, then the Main row by primary key).
 *
 * Threads are filtered in SQL before the LIMIT by the rule of spec section 5
 * ("What shows up"): followed in Slack (`thread_subs.subscribed`) or with an
 * unread mention of the user; `sidebarPlacement` applies the same rule again
 * on the shaped topic, so the pure rule stays the one that decides. Main
 * rows carry `channel_activity_ts`, the latest activity anywhere in the
 * channel, so the quiet rule counts thread replies (one indexed `max` per
 * Main row on `topic_index_channel_activity`).
 *
 * `rev` is a hash of every input the shaped row depends on (the index row's
 * own rev, the overlay, the conversation, the people on the row, the
 * placement), so a change in any joined table is a new rev and reaches the
 * renderer as a delta; an unchanged row keeps its identity there.
 */
import {
  canResolveOnHover,
  channelLabel,
  contextTint,
  defaultChannelStyle,
  defaultPersonColor,
  hashId,
  isDm,
  isResolved,
  isSubscribed,
  quietDaysOf,
  resolveTitle,
  rowTags,
  sidebarPlacement,
  topicStatus,
  tsToMillis,
  byLatestActivity,
  type ChannelId,
  type ChannelInfo,
  type Topic,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { Person, TopicCounts, TopicRow } from '@juno/contract'
import { StoreReader, type SqlError, type TopicIndexRow } from '@juno/store'
import type { StoredPreview } from '@juno/sync'
import { Effect } from 'effect'
import type { ListRun } from '../protocol/live'

export interface ListFilter {
  readonly kind: 'all' | 'channels' | 'dms'
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
}

export interface QueryOptions {
  /** Wall-clock millis. */
  readonly now: number
  /** The window size; capped by the handler. */
  readonly limit: number
}

const DAY = 24 * 60 * 60 * 1000
const MAX_PARTICIPANTS = 4

interface JoinedRow extends TopicIndexRow {
  readonly c_kind: 'public' | 'private' | 'im' | 'mpim'
  readonly c_name: string | null
  readonly c_user_id: string | null
  readonly c_members: string | null
  readonly manual_title: string | null
  readonly ai_title: string | null
  readonly resolved_at: string | null
  readonly resolved_activity_ts: string | null
  readonly reopened_at: string | null
  readonly pinned_at: string | null
  readonly unsubscribed_at: string | null
  readonly subscribed: 0 | 1 | null
  /** Main rows only: the latest `last_activity_ts` of any topic in the channel. */
  readonly channel_activity_ts: string | null
}

interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_url: string | null
}

const millis = (value: string | null): number | undefined => {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** The quiet window from prefs (clamped by the domain rule) and the signed-in user. */
const settings = Effect.gen(function* () {
  const sql = yield* StoreReader
  const prefs = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`
  const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  const raw = prefs[0] === undefined ? undefined : (JSON.parse(prefs[0].value_json) as unknown)
  return { quietDays: typeof raw === 'number' ? raw : undefined, selfId: team[0]?.self_user_id ?? undefined }
})

const SELECT = `
  SELECT i.*, c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members,
    o.manual_title, o.ai_title, o.resolved_at, o.resolved_activity_ts, o.reopened_at, o.pinned_at, o.unsubscribed_at,
    s.subscribed AS subscribed,
    CASE WHEN i.kind = 'main' THEN (SELECT max(t.last_activity_ts) FROM topic_index t WHERE t.channel = i.channel) END AS channel_activity_ts`

const FROM = `
  FROM topic_index i
  JOIN conversations c ON c.id = i.channel
  LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
  LEFT JOIN ignored_channels ig ON ig.channel = i.channel
  LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts`

/**
 * Spec section 5, "Which threads": a thread row is a candidate when followed
 * in Slack, or when it carries an unread mention of the user and Slack has
 * said nothing about it (an explicit unfollow is `unsubscribed`, hidden).
 */
const THREAD_RULE = ` AND (i.kind <> 'thread' OR s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))`

const kindClause = (kind: ListFilter['kind']): string =>
  kind === 'channels' ? ` AND c.kind IN ('public', 'private')` : kind === 'dms' ? ` AND c.kind IN ('im', 'mpim')` : ''

/** The four statements, as SQL text with positional parameters, so the plan test can run them too. */
export function listStatements(filter: ListFilter, cutoff: string, limit: number): ReadonlyArray<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }> {
  const common = ` AND c.is_member = 1 AND ig.channel IS NULL${kindClause(filter.kind)}${filter.unreadOnly ? ' AND i.unread_count > 0' : ''}`
  const scope = filter.scope === undefined ? '' : ' AND i.channel = ?'
  const scopeParams = filter.scope === undefined ? [] : [filter.scope]
  return [
    {
      sql: `${SELECT}${FROM} WHERE i.last_activity_ts >= ?${scope}${common}${THREAD_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...scopeParams, limit],
    },
    {
      sql: `${SELECT}${FROM} WHERE o.pinned_at IS NOT NULL${scope}${common}`,
      params: scopeParams,
    },
    {
      sql: `${SELECT}${FROM} WHERE i.unread_count > 0 AND i.last_activity_ts < ?${scope}${common}${THREAD_RULE} ORDER BY i.last_activity_ts DESC LIMIT ?`,
      params: [cutoff, ...scopeParams, limit],
    },
    {
      // Main rows kept alive by replies in the channel's threads: the channels with a topic inside the window, then each Main by key.
      sql: `${SELECT}${FROM} WHERE i.topic_id IN (SELECT 'm:' || t.channel FROM topic_index t WHERE t.last_activity_ts >= ?${filter.scope === undefined ? '' : ' AND t.channel = ?'})
        AND i.last_activity_ts < ?${common} LIMIT ?`,
      params: [cutoff, ...scopeParams, cutoff, limit],
    },
  ]
}

/** The counts statement: unread topics the sidebar would show, per conversation kind. */
export function countsStatement(scope: string | undefined): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  return {
    sql: `SELECT c.kind AS kind, count(*) AS n FROM topic_index i
      JOIN conversations c ON c.id = i.channel
      LEFT JOIN ignored_channels ig ON ig.channel = i.channel
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts
      WHERE i.unread_count > 0 AND i.last_activity_ts > '0' AND c.is_member = 1 AND ig.channel IS NULL AND o.unsubscribed_at IS NULL${THREAD_RULE}${scope === undefined ? '' : ' AND i.channel = ?'}
      GROUP BY c.kind`,
    params: scope === undefined ? [] : [scope],
  }
}

/** The sidebar window as `TopicRow`s, pinned first, then recent, both newest first. */
export const listTopics = (filter: ListFilter, options: QueryOptions): Effect.Effect<ListRun<TopicRow>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const { quietDays, selfId } = yield* settings
    const ctx = { now: options.now, ...(quietDays === undefined ? {} : { quietDays }) }
    const cutoffMillis = options.now - quietDaysOf(ctx) * DAY
    const cutoff = `${Math.floor(cutoffMillis / 1000)}.000000`

    const byId = new Map<string, JoinedRow>()
    for (const statement of listStatements(filter, cutoff, options.limit)) {
      const rows = yield* sql.unsafe<JoinedRow>(statement.sql, statement.params)
      for (const row of rows) byId.set(row.topic_id, row)
    }

    // Names and photos: participants, DM partners and group DM members, in one lookup.
    const userIds = new Set<string>()
    const parsed = new Map<JoinedRow, Parsed>()
    for (const row of byId.values()) {
      const participants = parseIds(row.participants_json).slice(0, MAX_PARTICIPANTS)
      const preview = parsePreview(row.preview_json)
      parsed.set(row, { participants, preview })
      for (const id of participants) userIds.add(id)
      if (row.c_user_id !== null) userIds.add(row.c_user_id)
      if (row.c_kind === 'mpim') for (const id of parseIds(row.c_members)) userIds.add(id)
      if (preview.senderId !== undefined) userIds.add(preview.senderId)
    }
    const users = new Map<string, UserRow>()
    if (userIds.size > 0) {
      const found = yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...userIds])}`
      for (const user of found) users.set(user.id, user)
    }
    const people = new Map<string, Person>()
    const personOf = (id: string): Person => {
      let person = people.get(id)
      if (person === undefined) {
        const user = users.get(id)
        const name = user?.display_name ?? user?.real_name ?? user?.name ?? id
        person = { id, name, ...(user?.avatar_url ? { avatarUrl: user.avatar_url } : {}), color: defaultPersonColor(id) }
        people.set(id, person)
      }
      return person
    }
    const nameOf = (id: string) => personOf(id).name

    const pinned: Array<{ topic: Topic; row: JoinedRow }> = []
    const recent: Array<{ topic: Topic; row: JoinedRow }> = []
    for (const row of byId.values()) {
      if (row.last_activity_ts === null) continue
      const { participants, preview } = parsed.get(row)!
      const channel = channelOf(row, selfId, nameOf)
      const topic: Topic = {
        id: row.topic_id as Topic['id'],
        kind: row.kind,
        channel,
        activity: {
          lastActivityTs: row.last_activity_ts as Ts,
          ...(row.channel_activity_ts === null ? {} : { channelLastActivityTs: row.channel_activity_ts as Ts }),
          messageCount: row.message_count,
          unreadCount: row.unread_count,
          unreadExact: row.unread_exact === 1,
          mentionsMe: row.mentions_me === 1,
          participants: participants as unknown as ReadonlyArray<UserId>,
        },
        overlay: {
          ...(row.manual_title === null ? {} : { manualTitle: row.manual_title }),
          ...(row.ai_title === null ? {} : { aiTitle: row.ai_title }),
          ...(millis(row.resolved_at) === undefined ? {} : { resolvedAt: millis(row.resolved_at)! }),
          ...(row.resolved_activity_ts === null ? {} : { resolvedActivityTs: row.resolved_activity_ts as Ts }),
          ...(millis(row.reopened_at) === undefined ? {} : { reopenedAt: millis(row.reopened_at)! }),
          ...(millis(row.pinned_at) === undefined ? {} : { pinnedAt: millis(row.pinned_at)! }),
          ...(millis(row.unsubscribed_at) === undefined ? {} : { unsubscribedAt: millis(row.unsubscribed_at)! }),
        },
        ...(row.subscribed === null ? {} : { slackSubscribed: row.subscribed === 1 }),
        ...(preview.rootText === undefined ? {} : { firstMessageText: preview.rootText }),
      }
      const placement = sidebarPlacement(topic, ctx)
      if (placement === 'pinned') pinned.push({ topic, row })
      else if (placement === 'recent') recent.push({ topic, row })
    }
    pinned.sort((a, b) => byLatestActivity(a.topic, b.topic))
    recent.sort((a, b) => byLatestActivity(a.topic, b.topic))

    const rows: Array<TopicRow> = []
    for (const { topic, row } of pinned) rows.push(shape(topic, row, parsed.get(row)!.preview, 'pinned', ctx, personOf))
    for (const { topic, row } of recent) {
      if (rows.length >= options.limit) break
      rows.push(shape(topic, row, parsed.get(row)!.preview, 'recent', ctx, personOf))
    }
    return { rows, total: rows.length }
  })

interface Parsed {
  readonly participants: ReadonlyArray<string>
  readonly preview: StoredPreview
}

function shape(
  topic: Topic,
  row: JoinedRow,
  stored: StoredPreview,
  section: TopicRow['section'],
  ctx: { now: number; quietDays?: number },
  personOf: (id: string) => Person,
): TopicRow {
  const status = topicStatus(topic, ctx)
  const partner = topic.channel.kind === 'im' && row.c_user_id !== null ? personOf(row.c_user_id) : undefined
  const people = topic.activity.participants.map(personOf)
  const sender = stored.senderId !== undefined && stored.sender !== 'You' ? personOf(stored.senderId).name : stored.sender
  // Everything the row is built from, in one short string; the row's rev is its hash.
  const revKey = [
    row.rev,
    row.manual_title,
    row.ai_title,
    row.resolved_at,
    row.resolved_activity_ts,
    row.reopened_at,
    row.pinned_at,
    row.unsubscribed_at,
    row.subscribed,
    row.c_name,
    row.c_kind,
    topic.channel.name,
    section,
    status,
    sender,
    ...(partner === undefined ? [] : [partner.name, partner.avatarUrl]),
    ...people.flatMap((p) => [p.name, p.avatarUrl]),
  ].join('\u0001')

  const title = resolveTitle(topic)
  const preview = { sender, text: stored.text, line: stored.text.length === 0 ? sender : `${sender}: ${stored.text}` }
  const resolved = isResolved(topic)
  const style = defaultChannelStyle(topic.channel.id, topic.channel.kind)
  const shaped: Omit<TopicRow, 'rev'> = {
    id: topic.id,
    kind: topic.kind,
    section,
    status: status === 'ignored' ? 'open' : status,
    title: title.text,
    titleSource: title.source,
    preview,
    channel: {
      id: topic.channel.id,
      kind: topic.channel.kind,
      name: topic.channel.kind === 'public' || topic.channel.kind === 'private' ? topic.channel.name : channelLabel(topic.channel),
      label: channelLabel(topic.channel),
      tint: contextTint(topic.channel.kind),
      icon: style.icon,
      color: style.color,
      ...(partner === undefined ? {} : { partner }),
    },
    participants: people,
    messageCount: topic.activity.messageCount,
    unreadCount: topic.activity.unreadCount,
    unreadExact: topic.activity.unreadExact !== false,
    mentionsMe: topic.activity.mentionsMe,
    tags: rowTags(topic),
    pinned: topic.overlay.pinnedAt !== undefined,
    resolved,
    canResolveOnHover: canResolveOnHover(topic),
    subscribed: isSubscribed(topic),
    lastActivityTs: topic.activity.lastActivityTs,
    lastActivityAt: tsToMillis(topic.activity.lastActivityTs),
  }
  return { ...shaped, rev: hashId(revKey) }
}

function channelOf(row: JoinedRow, selfId: string | undefined, nameOf: (id: string) => string): ChannelInfo {
  const id = row.channel as ChannelId
  switch (row.c_kind) {
    case 'im':
      return { id, kind: 'im', name: row.c_user_id === null ? (row.c_name ?? id) : nameOf(row.c_user_id) }
    case 'mpim': {
      const members = parseIds(row.c_members).filter((member) => member !== selfId)
      return { id, kind: 'mpim', name: row.c_name ?? id, memberNames: members.map(nameOf) }
    }
    default:
      return { id, kind: row.c_kind, name: row.c_name ?? id }
  }
}

function parseIds(json: string | null): ReadonlyArray<string> {
  if (json === null) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function parsePreview(json: string | null): StoredPreview {
  if (json === null) return { sender: '', text: '' }
  try {
    return JSON.parse(json) as StoredPreview
  } catch {
    return { sender: '', text: '' }
  }
}

/** Unread topics per group for the filter dots. */
export const countTopics = (scope: string | undefined): Effect.Effect<TopicCounts, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const statement = countsStatement(scope)
    const rows = yield* sql.unsafe<{ kind: 'public' | 'private' | 'im' | 'mpim'; n: number }>(statement.sql, statement.params)
    let channelsUnread = 0
    let dmsUnread = 0
    for (const row of rows) {
      if (isDm(row.kind)) dmsUnread += row.n
      else channelsUnread += row.n
    }
    return { channelsUnread, dmsUnread }
  })
