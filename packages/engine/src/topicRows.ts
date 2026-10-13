/**
 * A `topic_index` row joined with what decides how it looks: the overlay,
 * the conversation and Slack's follow flag, and the glue that turns it into
 * the domain's `Topic`, a `ChannelInfo` and the wire's `ChannelRef` and
 * `Person`. The sidebar query (`topics/query.ts`) and the topic header
 * (`messages/detail.ts`) shape topics the same way through it.
 *
 * A top-level module, like `workspace.ts`, because two feature folders use
 * it and feature folders do not import each other.
 */
import {
  channelLabel,
  contextTint,
  defaultChannelStyle,
  defaultPersonColor,
  type ChannelId,
  type ChannelInfo,
  type Topic,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { ChannelRef, Person } from '@juno/contract'
import type { TopicIndexRow } from '@juno/store'
import type { StoredPreview } from '@juno/sync'

export interface JoinedRow extends TopicIndexRow {
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

/** The columns of a `JoinedRow`, without `channel_activity_ts`. */
export const TOPIC_COLUMNS = `
  SELECT i.*, c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members,
    o.manual_title, o.ai_title, o.resolved_at, o.resolved_activity_ts, o.reopened_at, o.pinned_at, o.unsubscribed_at,
    s.subscribed AS subscribed`

/** `topic_index` as `i` with its conversation `c`, overlay `o`, ignored flag `ig` and Slack follow flag `s`. */
export const TOPIC_FROM = `
  FROM topic_index i
  JOIN conversations c ON c.id = i.channel
  LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
  LEFT JOIN ignored_channels ig ON ig.channel = i.channel
  LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts`

export interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_url: string | null
}

/** The name a row shows for a user: the display name, the real name, the handle, or the raw id. */
export const userName = (id: string, user: UserRow | null | undefined): string => user?.display_name ?? user?.real_name ?? user?.name ?? id

/** A `Person` for a user id. `known` is the person sent before, kept when nothing changed so callers can compare by identity. */
export function personFrom(id: string, user: UserRow | null | undefined, known?: Person): Person {
  const name = userName(id, user)
  const avatarUrl = user?.avatar_url ? user.avatar_url : undefined
  if (known !== undefined && known.name === name && known.avatarUrl === avatarUrl) return known
  return { id, name, ...(avatarUrl === undefined ? {} : { avatarUrl }), color: defaultPersonColor(id) }
}

/** The JSON columns of an index row, parsed. */
export interface ParsedColumns {
  readonly participants: ReadonlyArray<string>
  readonly preview: StoredPreview
  /** Group DM members, empty for any other kind. */
  readonly members: ReadonlyArray<string>
}

export const MAX_PARTICIPANTS = 4

export function parseColumns(row: JoinedRow): ParsedColumns {
  return {
    participants: parseIds(row.participants_json).slice(0, MAX_PARTICIPANTS),
    preview: parsePreview(row.preview_json),
    members: row.c_kind === 'mpim' ? parseIds(row.c_members) : [],
  }
}

export function parseIds(json: string | null): ReadonlyArray<string> {
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

/** Every user id the row names: participants, the DM partner, group DM members and the preview's sender. */
export function userIdsOf(row: JoinedRow, columns: ParsedColumns, into: Set<string>): void {
  for (const id of columns.participants) into.add(id)
  for (const id of columns.members) into.add(id)
  if (row.c_user_id !== null) into.add(row.c_user_id)
  if (columns.preview.senderId !== undefined) into.add(columns.preview.senderId)
}

export function channelInfoOf(row: JoinedRow, columns: ParsedColumns, selfId: string | undefined, nameOf: (id: string) => string): ChannelInfo {
  const id = row.channel as ChannelId
  switch (row.c_kind) {
    case 'im':
      return { id, kind: 'im', name: row.c_user_id === null ? (row.c_name ?? id) : nameOf(row.c_user_id) }
    case 'mpim': {
      const members = columns.members.filter((member) => member !== selfId)
      return { id, kind: 'mpim', name: row.c_name ?? id, memberNames: members.map(nameOf) }
    }
    default:
      return { id, kind: row.c_kind, name: row.c_name ?? id }
  }
}

/** The wire's channel for a topic's channel. `partnerId` is the DM partner, a `Person` in the same refs. */
export function channelRefOf(channel: ChannelInfo, partnerId: string | undefined): ChannelRef {
  const label = channelLabel(channel)
  const style = defaultChannelStyle(channel.id, channel.kind)
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.kind === 'public' || channel.kind === 'private' ? channel.name : label,
    label,
    tint: contextTint(channel.kind),
    icon: style.icon,
    color: style.color,
    ...(partnerId === undefined ? {} : { partnerId }),
  }
}

/** The activity of a topic the index does not hold yet: the earliest ts there is. */
const NO_ACTIVITY = '0000000000.000000'

const millis = (value: string | null): number | undefined => {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** The domain topic for a joined row, for the pure rules (title, status, placement, tags). */
export function topicFrom(row: JoinedRow, columns: ParsedColumns, channel: ChannelInfo): Topic {
  const { participants, preview } = columns
  return {
    id: row.topic_id as Topic['id'],
    kind: row.kind,
    channel,
    activity: {
      lastActivityTs: (row.last_activity_ts ?? NO_ACTIVITY) as Ts,
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
}
