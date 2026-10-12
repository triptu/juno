/**
 * Writes: posting, editing and deleting messages, and reactions.
 *
 * Source: docs/research/slack-data-access.md section 3 (Posting, Reactions).
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormBoolean, FormJson, RawObject } from './common.ts'
import { Ts } from './ts.ts'
import { Message } from './message.ts'

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

/** `chat.postMessage` errors the official client handles specially. */
export const PostMessageErrors = [
  'message_limit_exceeded',
  'ekm_access_denied',
  'dlp_user_warning',
  'message_send_ratelimit',
  'msg_too_long',
  'no_text',
  'is_archived',
  'not_in_channel',
  'channel_not_found',
] as const

// chat.update

export const ChatUpdateArgs = S.Struct({
  channel: S.String,
  ts: Ts,
  text: opt(S.String),
  blocks: opt(FormJson(Blocks)),
  markdown_text: opt(S.String),
  file_ids: opt(FormJson(S.Array(S.String))),
  skip_dlp_user_warning: opt(FormBoolean),
})
export type ChatUpdateArgs = typeof ChatUpdateArgs.Type

export const ChatUpdateFields = { channel: S.String, ts: Ts, text: opt(S.String), message: opt(Message) } as const

// chat.delete

export const ChatDeleteArgs = S.Struct({ channel: S.String, ts: Ts })
export type ChatDeleteArgs = typeof ChatDeleteArgs.Type
export const ChatDeleteFields = { channel: S.String, ts: Ts } as const

// reactions.add / reactions.remove

export const ReactionArgs = S.Struct({ channel: S.String, timestamp: Ts, name: S.String })
export type ReactionArgs = typeof ReactionArgs.Type
export const ReactionFields = {} as const
