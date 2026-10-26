/**
 * Writes: posting, forwarding, editing and deleting messages, reactions, and
 * pressing a message's button.
 *
 * Source: docs/research/slack-data-access.md section 3 (Posting, Reactions),
 * docs/research/slack-forward.md (Forward).
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormBoolean, FormJson, RawObject } from './common.ts'
import { Ts } from './ts.ts'
import { AttachmentAction, Message, Reaction } from './message.ts'

const opt = S.optionalKey

// chat.postMessage

export const ChatPostMessageArgs = S.Struct({
  channel: S.String,
  /** Client-generated ts; the server assigns the real one. */
  ts: opt(Ts),
  type: opt(S.Literal('message')),
  text: opt(S.String),
  blocks: opt(FormJson(Blocks)),
  markdown_text: opt(S.String),
  thread_ts: opt(Ts),
  reply_broadcast: opt(FormBoolean),
  /** Required for Juno: the socket echo and history pages are matched on it (ADR 0011). */
  client_msg_id: S.String,
  include_channel_perm_error: opt(FormBoolean),
  skip_dlp_user_warning: opt(FormBoolean),
  unfurl: opt(S.String),
  draft_id: opt(S.String),
  xArgs: opt(FormJson(RawObject)),
})
export type ChatPostMessageArgs = typeof ChatPostMessageArgs.Type

export const ChatPostMessageFields = { channel: S.String, ts: Ts, message: Message } as const

// chat.shareMessage

/**
 * A forward, as the official client's Forward dialog sends it: the message
 * at `channel` and `timestamp`, shared into `share_channel`, which must be
 * a conversation id (a user id is `channel_not_found`). `text` is always
 * empty; the note goes in `blocks`. The message Slack stores carries
 * `client_msg_id`, so it is matched as a post is (research `slack-forward.md`).
 */
export const ChatShareMessageArgs = S.Struct({
  channel: S.String,
  timestamp: Ts,
  share_channel: S.String,
  text: S.String,
  blocks: opt(FormJson(Blocks)),
  client_msg_id: S.String,
  skip_dlp_user_warning: opt(FormBoolean),
})
export type ChatShareMessageArgs = typeof ChatShareMessageArgs.Type

/** The answer names the new message without carrying it. */
export const ChatShareMessageFields = { channel: S.String, ts: Ts } as const

// chat.update

/**
 * An edit, or with `reply_broadcast` and nothing else a thread reply also
 * sent to the channel, as the official client's "Send reply to this
 * channel" does. Slack refuses both in one call
 * (`no_dual_broadcast_content_update`), and a root or a reply already sent
 * with `cant_broadcast_message` (research `slack-data-access.md`, "Send an
 * existing reply to the channel").
 */
export const ChatUpdateArgs = S.Struct({
  channel: S.String,
  ts: Ts,
  text: opt(S.String),
  blocks: opt(FormJson(Blocks)),
  markdown_text: opt(S.String),
  file_ids: opt(FormJson(S.Array(S.String))),
  reply_broadcast: opt(FormBoolean),
  skip_dlp_user_warning: opt(FormBoolean),
})
export type ChatUpdateArgs = typeof ChatUpdateArgs.Type

// The nested message may contain only text and user; ts belongs to the response envelope.
// https://docs.slack.dev/reference/methods/chat.update/#response
export const ChatUpdateFields = { channel: S.String, ts: Ts, text: opt(S.String), message: opt(S.Struct({ ...Message.fields, ts: opt(Ts) })) } as const

// chat.delete

export const ChatDeleteArgs = S.Struct({ channel: S.String, ts: Ts })
export type ChatDeleteArgs = typeof ChatDeleteArgs.Type
export const ChatDeleteFields = { channel: S.String, ts: Ts } as const

// chat.attachmentAction

/**
 * A press on a legacy attachment's button, as the official client sends it
 * for every app, Slackbot included: the action as it came, and where it was
 * (research `integration-shapes.md`, "Buttons on a Slackbot message").
 * Slack answers with the change on the socket: the message replaced, or
 * `message_deleted`.
 */
export const AttachmentActionPayload = S.Struct({
  actions: S.Array(AttachmentAction),
  attachment_id: S.String,
  callback_id: opt(S.String),
  channel_id: S.String,
  is_ephemeral: S.Boolean,
  thread_ts: opt(Ts),
  message_ts: Ts,
  prompt_app_install: S.Boolean,
})
export type AttachmentActionPayload = typeof AttachmentActionPayload.Type

export const ChatAttachmentActionArgs = S.Struct({
  payload: FormJson(AttachmentActionPayload),
  /** `web-<epoch ms>`, as the official client makes it. */
  client_token: S.String,
  /** The message's `bot_id`. */
  service_id: opt(S.String),
  /** The message's `user`. */
  bot_user_id: opt(S.String),
})
export type ChatAttachmentActionArgs = typeof ChatAttachmentActionArgs.Type
export const ChatAttachmentActionFields = { replaced: opt(S.Boolean), deleted: opt(S.Boolean) } as const

// reactions.add / reactions.remove

export const ReactionArgs = S.Struct({ channel: S.String, timestamp: Ts, name: S.String })
export type ReactionArgs = typeof ReactionArgs.Type
export const ReactionFields = {} as const

// reactions.get
// A message's `reactions[].users` may list fewer people than `count`; with
// `full` Slack lists everyone (research section 10, "Who reacted"). Only the
// message's reactions are decoded; a file's are not used.
// https://docs.slack.dev/reference/methods/reactions.get

export const ReactionsGetArgs = S.Struct({ channel: S.String, timestamp: Ts, full: opt(FormBoolean) })
export type ReactionsGetArgs = typeof ReactionsGetArgs.Type
export const ReactionsGetFields = { message: opt(S.Struct({ reactions: opt(S.Array(Reaction)) })) } as const
