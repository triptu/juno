/**
 * Conversations (channels, private channels, DMs, group DMs), history and
 * replies, marking read, and opening DMs.
 *
 * Source: docs/research/slack-data-access.md sections 2, 3 and 6.
 */
import { Schema as S } from 'effect'
import { FormBoolean, FormJson, FormNumber, ResponseMetadata } from './common.ts'
import { Ts } from './ts.ts'
import { Message } from './message.ts'
import { User } from './users.ts'

const opt = S.optionalKey

export const ChannelTopic = S.Struct({ value: S.String, creator: opt(S.String), last_set: opt(S.Number) })

/** `latest` is a ts in `client.counts` and a message object in channel info. Both are accepted. */
export const Latest = S.NullOr(S.Union([Ts, Message]))

/**
 * A conversation of any kind. Only `id` is required because events such as
 * `channel_rename` carry partial objects. DM objects (`is_im`) also fit here;
 * `Im` below is the stricter shape `client.userBoot` returns for them.
 */
export const Channel = S.Struct({
  id: S.String,
  name: opt(S.String),
  name_normalized: opt(S.String),
  is_channel: opt(S.Boolean),
  is_group: opt(S.Boolean),
  is_im: opt(S.Boolean),
  is_mpim: opt(S.Boolean),
  is_private: opt(S.Boolean),
  is_archived: opt(S.Boolean),
  is_frozen: opt(S.Boolean),
  is_general: opt(S.Boolean),
  /** Absent in `client.userBoot` live (see `ClientUserBootFields.channels`); present on `conversations.*` objects. */
  is_member: opt(S.Boolean),
  is_open: opt(S.Boolean),
  is_shared: opt(S.Boolean),
  is_ext_shared: opt(S.Boolean),
  is_org_shared: opt(S.Boolean),
  is_pending_ext_shared: opt(S.Boolean),
  is_starred: opt(S.Boolean),
  is_read_only: opt(S.Boolean),
  is_thread_only: opt(S.Boolean),
  is_user_deleted: opt(S.Boolean),
  user: opt(S.String),
  created: opt(S.Number),
  creator: opt(S.String),
  updated: opt(S.Number),
  context_team_id: opt(S.String),
  shared_team_ids: opt(S.Array(S.String)),
  parent_conversation: opt(S.NullOr(S.String)),
  topic: opt(ChannelTopic),
  purpose: opt(ChannelTopic),
  previous_names: opt(S.Array(S.String)),
  priority: opt(S.Number),
  members: opt(S.Array(S.String)),
  num_members: opt(S.Number),
  last_read: opt(Ts),
  latest: opt(Latest),
  unread_count: opt(S.Number),
  unread_count_display: opt(S.Number),
  properties: opt(S.Unknown),
})
export type Channel = typeof Channel.Type

/** A DM as `client.userBoot.ims` lists it. */
export const Im = S.Struct({
  id: S.String,
  user: S.String,
  is_im: opt(S.Boolean),
  is_open: opt(S.Boolean),
  is_user_deleted: opt(S.Boolean),
  is_org_shared: opt(S.Boolean),
  created: opt(S.Number),
  updated: opt(S.Number),
  priority: opt(S.Number),
  context_team_id: opt(S.String),
  last_read: opt(Ts),
  latest: opt(Latest),
  unread_count: opt(S.Number),
  unread_count_display: opt(S.Number),
})
export type Im = typeof Im.Type

export function conversationKind(c: Pick<Channel, 'is_im' | 'is_mpim' | 'is_private' | 'is_group'>): 'public' | 'private' | 'im' | 'mpim' {
  if (c.is_im === true) return 'im'
  if (c.is_mpim === true) return 'mpim'
  if (c.is_private === true || c.is_group === true) return 'private'
  return 'public'
}

// conversations.history

/** Message ts to server version, observed live (slack-catchup.md). */
export const CachedLatestUpdates = FormJson(S.Record(S.String, Ts))

export const ConversationsHistoryArgs = S.Struct({
  channel: S.String,
  limit: opt(FormNumber),
  oldest: opt(S.String),
  latest: opt(S.String),
  inclusive: opt(FormBoolean),
  cursor: opt(S.String),
  ignore_replies: opt(FormBoolean),
  include_mutation_timestamps: opt(FormBoolean),
  include_pin_count: opt(FormBoolean),
  no_user_profile: opt(FormBoolean),
  include_stories: opt(FormBoolean),
  include_free_team_extra_messages: opt(FormBoolean),
  include_date_joined: opt(FormBoolean),
  include_tombstones: opt(FormBoolean),
  cached_latest_updates: opt(CachedLatestUpdates),
})
export type ConversationsHistoryArgs = typeof ConversationsHistoryArgs.Type

/** Fields shared by history and replies responses. */
const PageFields = {
  is_limited: opt(S.Boolean),
  messages: S.Array(Message),
  has_more: S.Boolean,
  response_metadata: opt(ResponseMetadata),
  /** Ts of messages deleted since `cached_latest_updates`. */
  deleted: opt(S.Array(Ts)),
  /** Versions of returned message bodies. */
  latest_updates: opt(S.Record(S.String, Ts)),
  unchanged_messages: opt(S.Array(Ts)),
} as const

export const ConversationsHistoryFields = {
  ...PageFields,
  mutation_timestamps: opt(S.Struct({ latest: opt(S.NullOr(Ts)), updated: opt(Ts), history_invalid: opt(Ts) })),
  pin_count: opt(S.Number),
  channel_actions_count: opt(S.Number),
  channel_actions_ts: opt(S.NullOr(Ts)),
  date_joined: opt(S.Unknown),
} as const

// conversations.replies

export const ConversationsRepliesArgs = S.Struct({
  channel: S.String,
  ts: Ts,
  limit: opt(FormNumber),
  oldest: opt(S.String),
  latest: opt(S.String),
  inclusive: opt(FormBoolean),
  cursor: opt(S.String),
  include_tombstones: opt(FormBoolean),
  cached_latest_updates: opt(CachedLatestUpdates),
})
export type ConversationsRepliesArgs = typeof ConversationsRepliesArgs.Type

export const ConversationsRepliesFields = PageFields

// conversations.view (the client's "open this channel" call; response shape is inferred, research section 2)

// conversations.info

export const ConversationsInfoArgs = S.Struct({
  channel: S.String,
  include_num_members: opt(FormBoolean),
  include_locale: opt(FormBoolean),
})
export type ConversationsInfoArgs = typeof ConversationsInfoArgs.Type

export const ConversationsInfoFields = { channel: Channel } as const

export const ConversationsViewArgs = S.Struct({
  channel: opt(S.String),
  count: opt(FormNumber),
  canonical_avatars: opt(FormBoolean),
  no_user_profile: opt(FormBoolean),
  ignore_replies: opt(FormBoolean),
  no_self: opt(FormBoolean),
  include_full_users: opt(FormBoolean),
  include_use_case: opt(FormBoolean),
  include_stories: opt(FormBoolean),
  no_members: opt(FormBoolean),
  include_mutation_timestamps: opt(FormBoolean),
  include_free_team_extra_messages: opt(FormBoolean),
})
export type ConversationsViewArgs = typeof ConversationsViewArgs.Type

export const ConversationsViewFields = {
  channel: Channel,
  messages: opt(S.Array(Message)),
  has_more: opt(S.Boolean),
  users: opt(S.Array(User)),
  pins: opt(S.Unknown),
  bots: opt(S.Unknown),
  response_metadata: opt(ResponseMetadata),
} as const

// conversations.mark

export const ConversationsMarkArgs = S.Struct({
  channel: S.String,
  ts: Ts,
  previous_ts: opt(Ts),
  reason: opt(S.String),
})
export type ConversationsMarkArgs = typeof ConversationsMarkArgs.Type

export const ConversationsMarkFields = {} as const

// conversations.create

export const ConversationsCreateArgs = S.Struct({
  name: S.String,
  is_private: opt(FormBoolean),
})
export type ConversationsCreateArgs = typeof ConversationsCreateArgs.Type

export const ConversationsCreateFields = { channel: Channel } as const

// conversations.open

export const ConversationsOpenArgs = S.Struct({
  /** Comma-separated user ids. */
  users: opt(S.String),
  channel: opt(S.String),
  return_im: opt(FormBoolean),
  prevent_creation: opt(FormBoolean),
})
export type ConversationsOpenArgs = typeof ConversationsOpenArgs.Type

export const ConversationsOpenFields = {
  channel: Channel,
  no_op: opt(S.Boolean),
  already_open: opt(S.Boolean),
} as const

// api.getFlannelHttpUrl

export const GetFlannelHttpUrlArgs = S.Struct({ include_external_workspaces: opt(FormBoolean) })
export const GetFlannelHttpUrlFields = { url: S.String, ttl_seconds: opt(S.Number) } as const
