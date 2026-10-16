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
  mentionedUserIds,
  type ChannelId,
  type ChannelInfo,
  type Topic,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { ChannelRef, Person, TopicArt } from '@juno/contract'
import type { TopicIndexRow } from '@juno/store'
import type { StoredPreview } from '@juno/sync'
import { UNKNOWN_PERSON } from '@juno/richtext'

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
  readonly subscribed: 0 | 1 | null
  /** The stored drawing (`topic_art`): the recipe and whether it is shown (`ok`), or null when the topic was never drawn. */
  readonly art_recipe: string | null
  readonly art_status: 'ok' | 'unsure' | 'failed' | null
  /** Main rows only: the latest `last_activity_ts` of any topic in the channel. */
  readonly channel_activity_ts: string | null
}

/** The columns of a `JoinedRow`, without `channel_activity_ts`. */
export const TOPIC_COLUMNS = `
  SELECT i.*, c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members,
    o.manual_title, o.ai_title, o.resolved_at, o.resolved_activity_ts, o.reopened_at, o.pinned_at,
    s.subscribed AS subscribed, a.recipe AS art_recipe, a.status AS art_status`

/** `topic_index` as `i` with its conversation `c`, overlay `o`, ignored flag `ig`, Slack follow flag `s` and drawing `a`. */
export const TOPIC_FROM = `
  FROM topic_index i
  JOIN conversations c ON c.id = i.channel
  LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
  LEFT JOIN ignored_channels ig ON ig.channel = i.channel
  LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts
  LEFT JOIN topic_art a ON a.topic_id = i.topic_id`

export interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_small_url?: string | null
  readonly avatar_large_url?: string | null
  readonly avatar_url: string | null
}

/** The name a row shows for a user: the display name, the real name, the handle, or "Someone" until the user is stored. Never the raw id. */
export const userName = (_id: string, user: UserRow | null | undefined): string => user?.display_name ?? user?.real_name ?? user?.name ?? UNKNOWN_PERSON

/** A `Person` for a user id. `known` is the person sent before, kept when nothing changed so callers can compare by identity. */
export function personFrom(id: string, user: UserRow | null | undefined, known?: Person): Person {
  const name = userName(id, user)
  const avatarUrl = user?.avatar_url ? user.avatar_url : undefined
  if (known !== undefined && known.name === name && known.avatarUrl === avatarUrl && known.avatarSmallUrl === (user?.avatar_small_url || undefined) && known.avatarLargeUrl === (user?.avatar_large_url || undefined)) return known
  return { id, name, ...(user?.avatar_small_url ? { avatarSmallUrl: user.avatar_small_url } : {}), ...(user?.avatar_large_url ? { avatarLargeUrl: user.avatar_large_url } : {}), ...(avatarUrl === undefined ? {} : { avatarUrl }), color: defaultPersonColor(id) }
}

/** The JSON columns of an index row, parsed. */
export interface ParsedColumns {
  readonly participants: ReadonlyArray<string>
  readonly preview: StoredPreview
  /** Group DM members, empty for any other kind. */
  readonly members: ReadonlyArray<string>
}

/** How many of the row's people the avatar stack draws; the rest travel as a count. */
export const SHOWN_PARTICIPANTS = 4

export function parseColumns(row: JoinedRow): ParsedColumns {
  return {
    participants: parseIds(row.participants_json),
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

/** Every user id the row names: participants, the DM partner, group DM members, the preview's sender and the people the root mentions (for the title). */
export function userIdsOf(row: JoinedRow, columns: ParsedColumns, into: Set<string>): void {
  for (const id of columns.participants.slice(0, SHOWN_PARTICIPANTS)) into.add(id)
  for (const id of columns.members) into.add(id)
  if (row.c_user_id !== null) into.add(row.c_user_id)
  if (columns.preview.senderId !== undefined) into.add(columns.preview.senderId)
  for (const id of mentionedUserIds(columns.preview.rootText)) into.add(id)
}

/** A group DM tile shows at most this many members (it draws two; the third stands in for one without a photo). */
const TILE_MEMBERS = 3

/** A group DM's other members for its tile, in Slack's order; empty for any other kind. */
export function tileMemberIds(columns: Pick<ParsedColumns, 'members'>, selfId: string | undefined): ReadonlyArray<string> {
  return columns.members.filter((member) => member !== selfId).slice(0, TILE_MEMBERS)
}

export function channelInfoOf(
  row: Pick<JoinedRow, 'channel' | 'c_kind' | 'c_name' | 'c_user_id'>,
  columns: Pick<ParsedColumns, 'members'>,
  selfId: string | undefined,
  nameOf: (id: string) => string,
): ChannelInfo {
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

/**
 * The art ref a row sends (`refs.art`): the recipe when the drawing is shown,
 * and an empty recipe when a drawing exists but AI assist is off, so a
 * renderer that holds the recipe drops it. Nothing for a topic never drawn,
 * or drawn without confidence: the placeholder is the default.
 */
export function artRefOf(row: Pick<JoinedRow, 'topic_id' | 'art_recipe' | 'art_status'>, aiAssist: boolean): TopicArt | undefined {
  if (row.art_status !== 'ok' || row.art_recipe === null || row.art_recipe === '') return undefined
  return { id: row.topic_id, recipe: aiAssist ? row.art_recipe : '' }
}

/** The wire's channel for a topic's channel. `partnerId` is the DM partner and `memberIds` a group DM's members for its tile, `Person`s in the same refs. */
export function channelRefOf(channel: ChannelInfo, partnerId: string | undefined, memberIds: ReadonlyArray<string> = []): ChannelRef {
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
    ...(memberIds.length === 0 ? {} : { memberIds }),
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
    },
    ...(row.subscribed === null ? {} : { slackSubscribed: row.subscribed === 1 }),
    ...(preview.rootText === undefined ? {} : { firstMessageText: preview.rootText }),
  }
}
