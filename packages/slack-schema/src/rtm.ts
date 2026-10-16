/**
 * Websocket frames. `RtmFrame` decodes every incoming frame: known types get
 * their shape, anything else becomes `{ type: 'unknown', raw }`. A known type
 * with an unexpected shape fails to decode on purpose, so the socket client
 * can log it and skip it (architecture 5.4) instead of mistaking it for
 * something else.
 *
 * Source: docs/research/slack-data-access.md section 4.
 */
import { Schema as S, SchemaGetter } from 'effect'
import { RawObject } from './common.ts'
import { Ts } from './ts.ts'
import { Channel, Im } from './conversations.ts'
import { Message, MessageFields, StructuralSubtypes } from './message.ts'
import { ThreadSubscription } from './threads.ts'
import { Subteam, User } from './users.ts'

const opt = S.optionalKey

// Frames the client sends.

export const PingFrame = S.Struct({ type: S.Literal('ping'), id: S.Number })
export const TickleFrame = S.Struct({ type: S.Literal('tickle'), id: opt(S.Number) })
export const TypingFrame = S.Struct({
  type: S.Literal('user_typing'),
  id: opt(S.Number),
  channel: S.String,
  thread_ts: opt(Ts),
})
export const PresenceSubFrame = S.Struct({ type: S.Literal('presence_sub'), id: opt(S.Number), ids: S.Array(S.String) })

export const RtmOutgoingFrame = S.Union([PingFrame, TickleFrame, TypingFrame, PresenceSubFrame])
export type RtmOutgoingFrame = typeof RtmOutgoingFrame.Type

// Connection frames.

export const HelloFrame = S.Struct({
  type: S.Literal('hello'),
  region: opt(S.String),
  host_id: opt(S.String),
  fast_reconnect: opt(S.Boolean),
  flannel: opt(S.Unknown),
  /** Present on some connects; contents Unknown (research section 4). */
  start: opt(S.Unknown),
})
export const PongFrame = S.Struct({ type: S.Literal('pong'), reply_to: S.Number })
export const ErrorFrame = S.Struct({
  type: S.Literal('error'),
  error: S.Struct({ code: S.Number, msg: S.String, retry_after: opt(S.Number) }),
})
export const GoodbyeFrame = S.Struct({ type: S.Literal('goodbye') })
export const ReconnectUrlFrame = S.Struct({ type: S.Literal('reconnect_url'), url: S.String })
/** Frames with no payload that change the session's state. */
export const SignalFrame = S.Struct({
  type: S.Literals(['force_reload', 'user_session_expiration', 'access_paused', 'clear_cache']),
})

// message and its structural subtypes.

const notStructural = S.String.check(
  S.makeFilter((subtype: string) =>
    (StructuralSubtypes as ReadonlyArray<string>).includes(subtype) ? `structural subtype ${subtype}` : undefined,
  ),
)

const EventFields = {
  event_ts: opt(Ts),
  hidden: opt(S.Boolean),
  suppress_notification: opt(S.Boolean),
} as const

/** A new message. Any subtype except the structural ones, which have their own frames. */
export const MessagePostedEvent = S.Struct({
  ...MessageFields,
  type: S.Literal('message'),
  subtype: opt(notStructural),
  channel: S.String,
  root: opt(S.Struct(MessageFields)),
  ...EventFields,
})
export type MessagePostedEvent = typeof MessagePostedEvent.Type

export const MessageChangedEvent = S.Struct({
  type: S.Literal('message'),
  subtype: S.Literal('message_changed'),
  channel: S.String,
  ts: Ts,
  message: Message,
  previous_message: opt(Message),
  ...EventFields,
})
export type MessageChangedEvent = typeof MessageChangedEvent.Type

export const MessageDeletedEvent = S.Struct({
  type: S.Literal('message'),
  subtype: S.Literal('message_deleted'),
  channel: S.String,
  ts: opt(Ts),
  deleted_ts: Ts,
  previous_message: opt(Message),
  ...EventFields,
})
export type MessageDeletedEvent = typeof MessageDeletedEvent.Type

export const MessageRepliedEvent = S.Struct({
  type: S.Literal('message'),
  subtype: S.Literal('message_replied'),
  channel: S.String,
  ts: opt(Ts),
  message: S.Struct({
    ts: Ts,
    thread_ts: opt(Ts),
    user: opt(S.String),
    reply_count: S.Number,
    reply_users: opt(S.Array(S.String)),
    reply_users_count: opt(S.Number),
    latest_reply: opt(Ts),
    replies: opt(S.Array(S.Struct({ user: S.String, ts: Ts }))),
  }),
  ...EventFields,
})
export type MessageRepliedEvent = typeof MessageRepliedEvent.Type

export const MessageEvent = S.Union([MessageChangedEvent, MessageDeletedEvent, MessageRepliedEvent, MessagePostedEvent])
export type MessageEvent = typeof MessageEvent.Type

// Guards. `MessagePostedEvent.subtype` is any string but the structural ones,
// which TypeScript cannot express, so narrowing goes through these.
export const isMessagePosted = (frame: { type: string; subtype?: string }): frame is MessagePostedEvent =>
  frame.type === 'message' && !(StructuralSubtypes as ReadonlyArray<string>).includes(frame.subtype ?? '')
export const isMessageChanged = (frame: { type: string; subtype?: string }): frame is MessageChangedEvent =>
  frame.type === 'message' && frame.subtype === 'message_changed'
export const isMessageDeleted = (frame: { type: string; subtype?: string }): frame is MessageDeletedEvent =>
  frame.type === 'message' && frame.subtype === 'message_deleted'
export const isMessageReplied = (frame: { type: string; subtype?: string }): frame is MessageRepliedEvent =>
  frame.type === 'message' && frame.subtype === 'message_replied'

// Read state.

export const MarkedEvent = S.Struct({
  type: S.Literals(['channel_marked', 'group_marked', 'im_marked', 'mpim_marked']),
  channel: S.String,
  ts: Ts,
  unread_count: opt(S.Number),
  unread_count_display: opt(S.Number),
  num_mentions: opt(S.Number),
  num_mentions_display: opt(S.Number),
  mention_count: opt(S.Number),
  mention_count_display: opt(S.Number),
  event_ts: opt(Ts),
})
export type MarkedEvent = typeof MarkedEvent.Type

export const ThreadSubscriptionEvent = S.Struct({
  type: S.Literals(['thread_marked', 'thread_subscribed', 'thread_unsubscribed']),
  subscription: ThreadSubscription,
  event_ts: opt(Ts),
})
export type ThreadSubscriptionEvent = typeof ThreadSubscriptionEvent.Type

export const ThreadStateEvent = S.Struct({
  type: S.Literals(['update_thread_state', 'update_global_thread_state']),
  has_unreads: S.Boolean,
  mention_count: S.Number,
  unread_count_by_channel: opt(S.Record(S.String, S.Number)),
  mention_count_by_channel: opt(S.Record(S.String, S.Number)),
  timestamp: opt(Ts),
  channel_badges: opt(S.Unknown),
  org_wide: opt(S.Boolean),
  event_ts: opt(Ts),
})
export type ThreadStateEvent = typeof ThreadStateEvent.Type

// Reactions.

export const ReactionItem = S.Union([
  S.Struct({ type: S.Literal('message'), channel: S.String, ts: Ts }),
  S.Struct({ type: S.Literal('file'), file: S.String }),
  S.Struct({ type: S.Literal('file_comment'), file: S.String, file_comment: S.String }),
])
export const ReactionEvent = S.Struct({
  type: S.Literals(['reaction_added', 'reaction_removed']),
  user: S.String,
  reaction: S.String,
  item_user: opt(S.String),
  item: ReactionItem,
  event_ts: Ts,
  ts: opt(Ts),
})
export type ReactionEvent = typeof ReactionEvent.Type

// Presence and typing.

export const UserTypingEvent = S.Struct({
  type: S.Literal('user_typing'),
  channel: S.String,
  user: S.String,
  thread_ts: opt(Ts),
  id: opt(S.Number),
})
export type UserTypingEvent = typeof UserTypingEvent.Type

export const PresenceChangeEvent = S.Struct({
  type: S.Literals(['presence_change', 'manual_presence_change']),
  presence: S.Literals(['active', 'away']),
  users: opt(S.Array(S.String)),
  user: opt(S.String),
})
export type PresenceChangeEvent = typeof PresenceChangeEvent.Type

// Conversations and membership.

export const ChannelEvent = S.Struct({
  type: S.Literals([
    'channel_joined',
    'channel_left',
    'channel_created',
    'channel_rename',
    'channel_archive',
    'channel_unarchive',
    'channel_deleted',
    'channel_converted_to_shared',
    'group_joined',
    'group_left',
    'group_archive',
    'group_unarchive',
    'group_rename',
    'group_deleted',
  ]),
  /** A channel object for joined/created/rename, a bare id for the rest. */
  channel: S.Union([Channel, S.String]),
  user: opt(S.String),
  actor_id: opt(S.String),
  event_ts: opt(Ts),
})
export type ChannelEvent = typeof ChannelEvent.Type

export const ImEvent = S.Struct({
  type: S.Literals(['im_open', 'im_close', 'im_created', 'mpim_open', 'mpim_close', 'mpim_joined']),
  /** An object for `im_created` and `mpim_joined`, a bare id for the rest. */
  channel: S.Union([Im, Channel, S.String]),
  user: opt(S.String),
  event_ts: opt(Ts),
})
export type ImEvent = typeof ImEvent.Type

export const MemberEvent = S.Struct({
  type: S.Literals(['member_joined_channel', 'member_left_channel']),
  user: S.String,
  channel: S.String,
  channel_type: opt(S.String),
  team: opt(S.String),
  inviter: opt(S.String),
  event_ts: opt(Ts),
})
export type MemberEvent = typeof MemberEvent.Type

// Users and prefs.

export const UserChangeEvent = S.Struct({
  type: S.Literal('user_change'),
  user: User,
  cache_ts: opt(S.Number),
  event_ts: opt(Ts),
})
export type UserChangeEvent = typeof UserChangeEvent.Type

// User groups. Created and updated frames carry the whole group; a deleted group is an update with `date_delete` set.

export const SubteamEvent = S.Struct({
  type: S.Literals(['subteam_created', 'subteam_updated']),
  subteam: Subteam,
  event_ts: opt(Ts),
})
export type SubteamEvent = typeof SubteamEvent.Type

export const SubteamMembersChangedEvent = S.Struct({
  type: S.Literal('subteam_members_changed'),
  subteam_id: S.String,
  added_users: opt(S.Array(S.String)),
  removed_users: opt(S.Array(S.String)),
  event_ts: opt(Ts),
})
export type SubteamMembersChangedEvent = typeof SubteamMembersChangedEvent.Type

/** The signed-in user joined or left a group. */
export const SubteamSelfEvent = S.Struct({
  type: S.Literals(['subteam_self_added', 'subteam_self_removed']),
  subteam_id: S.String,
  event_ts: opt(Ts),
})
export type SubteamSelfEvent = typeof SubteamSelfEvent.Type

export const PrefChangeEvent = S.Struct({ type: S.Literal('pref_change'), name: S.String, value: S.Unknown })
export type PrefChangeEvent = typeof PrefChangeEvent.Type

// Files.

/**
 * A file was shared, changed, or Slack made its thumbnails. Live, a shared
 * image's echo carries no thumbnails and no size; `file_shared` comes with
 * it and `file_thumbnail_generated` a fraction of a second later with the
 * square and 360/480 thumbnail urls but no sizes. `file_shared`,
 * `file_change` and `file_public` carry `file: { id }` alone. Juno reads
 * only the id and asks `files.info` (research section 3).
 */
export const FileEvent = S.Struct({
  type: S.Literals(['file_change', 'file_shared', 'file_thumbnail_generated']),
  file_id: S.String,
  event_ts: opt(Ts),
})
export type FileEvent = typeof FileEvent.Type

// Notifications.

/** The server's "this matters" signal (research section 7). `msg` is the message ts. */
export const DesktopNotificationEvent = S.Struct({
  type: S.Literal('desktop_notification'),
  channel: S.String,
  msg: opt(Ts),
  ts: opt(Ts),
  thread_ts: opt(Ts),
  user: opt(S.String),
  title: S.String,
  subtitle: opt(S.String),
  content: S.String,
  is_shared: opt(S.Boolean),
  is_channel_invite: opt(S.Boolean),
  is_mpdm: opt(S.Boolean),
  launchUri: opt(S.String),
  imageUri: opt(S.NullOr(S.String)),
  avatarImage: opt(S.NullOr(S.String)),
  ssb_filename: opt(S.String),
  event_ts: opt(Ts),
  trace_ctx: opt(S.Unknown),
})
export type DesktopNotificationEvent = typeof DesktopNotificationEvent.Type

// The union, with the fallback.

export const KnownFrames = [
  HelloFrame,
  PongFrame,
  ErrorFrame,
  GoodbyeFrame,
  ReconnectUrlFrame,
  SignalFrame,
  MessageChangedEvent,
  MessageDeletedEvent,
  MessageRepliedEvent,
  MessagePostedEvent,
  MarkedEvent,
  ThreadSubscriptionEvent,
  ThreadStateEvent,
  ReactionEvent,
  UserTypingEvent,
  PresenceChangeEvent,
  ChannelEvent,
  ImEvent,
  MemberEvent,
  UserChangeEvent,
  SubteamEvent,
  SubteamMembersChangedEvent,
  SubteamSelfEvent,
  PrefChangeEvent,
  FileEvent,
  DesktopNotificationEvent,
] as const

/** Every `type` one of the known frames accepts. */
export const KnownFrameTypes: ReadonlySet<string> = new Set(
  KnownFrames.flatMap((frame) => {
    const type = frame.fields.type
    return 'literals' in type ? (type.literals as ReadonlyArray<string>) : [type.literal as string]
  }),
)

/** Any object whose `type` is not a known frame type, kept whole. Acks to outgoing frames (`reply_to`, no `type`) land here too. */
export const UnknownFrame = RawObject.check(
  S.makeFilter((raw) =>
    typeof raw['type'] === 'string' && KnownFrameTypes.has(raw['type'])
      ? `known frame type ${raw['type']} with an unexpected shape`
      : undefined,
  ),
).pipe(
  S.decodeTo(S.Struct({ type: S.Literal('unknown'), raw: RawObject }), {
    decode: SchemaGetter.transform((raw) => ({ type: 'unknown' as const, raw })),
    encode: SchemaGetter.transform((u) => u.raw),
  }),
)

export const RtmFrame = S.Union([...KnownFrames, UnknownFrame])
export type RtmFrame = typeof RtmFrame.Type

export const decodeRtmFrame = S.decodeUnknownSync(RtmFrame)
export const encodeRtmFrame = S.encodeSync(RtmFrame)
