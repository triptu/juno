/**
 * The message object as it appears in history, replies, thread views, search
 * results, post responses and socket events. Only `ts` is required: bot
 * messages have no `user`, tombstones have no `text`, and the fields a
 * message carries depend on the call that returned it.
 *
 * Source: docs/research/slack-data-access.md section 5.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { Ts } from './ts.ts'

const opt = S.optionalKey

export const Edited = S.Struct({ user: opt(S.String), ts: Ts })
export type Edited = typeof Edited.Type

export const Reaction = S.Struct({
  name: S.String,
  users: opt(S.Array(S.String)),
  count: opt(S.Number),
  url: opt(S.String),
})
export type Reaction = typeof Reaction.Type

/** A file on a message. Tombstones (`mode: "tombstone"`, `file_access: "file_not_found"`) carry only `id` and `mode`. */
export const File = S.Struct({
  id: S.String,
  created: opt(S.Number),
  timestamp: opt(S.Number),
  name: opt(S.NullOr(S.String)),
  title: opt(S.NullOr(S.String)),
  mimetype: opt(S.String),
  filetype: opt(S.String),
  pretty_type: opt(S.String),
  /** "slack_audio" or "slack_video" for a clip recorded in Slack. */
  subtype: opt(S.String),
  user: opt(S.String),
  user_team: opt(S.String),
  size: opt(S.Number),
  mode: opt(S.String),
  is_external: opt(S.Boolean),
  external_type: opt(S.String),
  is_public: opt(S.Boolean),
  file_access: opt(S.String),
  url_private: opt(S.String),
  url_private_download: opt(S.String),
  permalink: opt(S.String),
  permalink_public: opt(S.String),
  thumb_64: opt(S.String),
  thumb_80: opt(S.String),
  thumb_160: opt(S.String),
  thumb_360: opt(S.String),
  thumb_360_w: opt(S.Number),
  thumb_360_h: opt(S.Number),
  thumb_480: opt(S.String),
  thumb_480_w: opt(S.Number),
  thumb_480_h: opt(S.Number),
  thumb_720: opt(S.String),
  thumb_720_w: opt(S.Number),
  thumb_720_h: opt(S.Number),
  thumb_800: opt(S.String),
  thumb_800_w: opt(S.Number),
  thumb_800_h: opt(S.Number),
  thumb_960: opt(S.String),
  thumb_960_w: opt(S.Number),
  thumb_960_h: opt(S.Number),
  thumb_1024: opt(S.String),
  thumb_1024_w: opt(S.Number),
  thumb_1024_h: opt(S.Number),
  thumb_tiny: opt(S.String),
  /** A video's poster frame (research section 3, "Files"). */
  thumb_video: opt(S.String),
  thumb_video_w: opt(S.Number),
  thumb_video_h: opt(S.Number),
  /** A video Slack transcoded for playback. */
  mp4: opt(S.String),
  hls: opt(S.String),
  duration_ms: opt(S.Number),
  /** A text snippet preview from Slack. */
  preview: opt(S.String),
  preview_highlight: opt(S.String),
  preview_is_truncated: opt(S.Boolean),
  lines: opt(S.Number),
  lines_more: opt(S.Number),
  edit_link: opt(S.String),
  original_w: opt(S.Number),
  original_h: opt(S.Number),
})
export type File = typeof File.Type

export const AttachmentField = S.Struct({ title: opt(S.String), value: opt(S.String), short: opt(S.Boolean) })

/** Legacy attachments, still used by many bots and by link unfurls. */
export const Attachment = S.Struct({
  id: opt(S.Number),
  fallback: opt(S.String),
  text: opt(S.String),
  pretext: opt(S.String),
  title: opt(S.String),
  title_link: opt(S.String),
  image_width: opt(S.Number),
  image_height: opt(S.Number),
  actions: opt(S.Array(S.Struct({ type: opt(S.String), text: opt(S.String), url: opt(S.String), name: opt(S.String) }))),
  color: opt(S.String),
  author_name: opt(S.String),
  author_link: opt(S.String),
  author_icon: opt(S.String),
  image_url: opt(S.String),
  thumb_url: opt(S.String),
  footer: opt(S.String),
  footer_icon: opt(S.String),
  ts: opt(S.Union([S.String, S.Number])),
  fields: opt(S.Array(AttachmentField)),
  mrkdwn_in: opt(S.Array(S.String)),
  blocks: opt(Blocks),
  from_url: opt(S.String),
  original_url: opt(S.String),
  service_name: opt(S.String),
  service_icon: opt(S.String),
  is_msg_unfurl: opt(S.Boolean),
  /** A shared or linked Slack message: its own blocks, beside the same words as mrkdwn `text`. */
  message_blocks: opt(S.Array(S.Struct({ message: opt(S.Struct({ blocks: opt(Blocks) })) }))),
})
export type Attachment = typeof Attachment.Type

export const BotProfile = S.Struct({
  id: S.String,
  name: opt(S.String),
  app_id: opt(S.String),
  team_id: opt(S.String),
  deleted: opt(S.Boolean),
  updated: opt(S.Number),
  icons: opt(S.Record(S.String, S.String)),
})
export type BotProfile = typeof BotProfile.Type

/** The small profile inlined on messages when `no_user_profile` is not set. */
export const UserProfileLite = S.Struct({
  avatar_hash: opt(S.String),
  image_72: opt(S.String),
  first_name: opt(S.String),
  real_name: opt(S.String),
  display_name: opt(S.String),
  team: opt(S.String),
  name: opt(S.String),
  is_restricted: opt(S.Boolean),
  is_ultra_restricted: opt(S.Boolean),
})

/** Every message field. Spread into the schemas below so `root` does not need recursion. */
export const MessageFields = {
  type: opt(S.String),
  subtype: opt(S.String),
  channel: opt(S.String),
  ts: Ts,
  user: opt(S.String),
  bot_id: opt(S.NullOr(S.String)),
  bot_profile: opt(BotProfile),
  username: opt(S.String),
  app_id: opt(S.String),
  team: opt(S.String),
  user_team: opt(S.String),
  source_team: opt(S.String),
  text: opt(S.String),
  blocks: opt(Blocks),
  attachments: opt(S.Array(Attachment)),
  files: opt(S.Array(File)),
  upload: opt(S.Boolean),
  display_as_bot: opt(S.Boolean),
  reactions: opt(S.Array(Reaction)),
  edited: opt(Edited),
  client_msg_id: opt(S.String),
  // Threads. A root has reply_count and friends; a reply has thread_ts and parent_user_id.
  thread_ts: opt(Ts),
  parent_user_id: opt(S.String),
  reply_count: opt(S.Number),
  reply_users_count: opt(S.Number),
  reply_users: opt(S.Array(S.String)),
  latest_reply: opt(Ts),
  subscribed: opt(S.Boolean),
  last_read: opt(Ts),
  unread_count: opt(S.Number),
  reply_broadcast: opt(S.Boolean),
  is_locked: opt(S.Boolean),
  // Misc flags.
  hidden: opt(S.Boolean),
  is_starred: opt(S.Boolean),
  pinned_to: opt(S.Array(S.String)),
  pinned_info: opt(S.Unknown),
  no_notifications: opt(S.Boolean),
  permalink: opt(S.String),
  user_profile: opt(UserProfileLite),
  metadata: opt(S.Unknown),
} as const

/** A message without `root`. Also the shape of a thread root inside a `thread_broadcast`. */
export const ThreadRoot = S.Struct(MessageFields)
export type ThreadRoot = typeof ThreadRoot.Type

export const Message = S.Struct({ ...MessageFields, root: opt(ThreadRoot) })
export type Message = typeof Message.Type

/** Subtypes that change another message instead of being one. They arrive only on the socket. */
export const StructuralSubtypes = ['message_changed', 'message_deleted', 'message_replied'] as const

export function isThreadRoot(message: Pick<Message, 'ts' | 'thread_ts' | 'reply_count'>): boolean {
  return (message.thread_ts === undefined || message.thread_ts === message.ts) && (message.reply_count ?? 0) > 0
}

export function isReply(message: Pick<Message, 'ts' | 'thread_ts'>): boolean {
  return message.thread_ts !== undefined && message.thread_ts !== message.ts
}
