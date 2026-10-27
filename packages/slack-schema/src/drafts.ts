/**
 * Message drafts: the text in a channel's or a thread's message box, kept by
 * Slack so every device shows it, and the socket events for them.
 *
 * Source: docs/research/slack-drafts.md sections 1, 2 and 4 (observed live
 * 2026-10-27). Juno syncs only attached drafts (`is_from_composer: false`,
 * one per channel or thread); composer, scheduled and stashed drafts are
 * left alone, so their fields are optional and kept loose.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormBoolean, FormJson, FormNumber } from './common.ts'

const opt = S.optionalKey

export const DraftDestination = S.Struct({
  channel_id: opt(S.String),
  user_ids: opt(S.Array(S.String)),
  thread_ts: opt(S.String),
  /** "Also send to channel", on a thread destination. */
  broadcast: opt(S.Boolean),
  /** Set once the draft was sent. */
  message_ts: opt(S.String),
})
export type DraftDestination = typeof DraftDestination.Type

export const Draft = S.Struct({
  /** "Dr" and ten characters. Never reused. */
  id: S.String,
  /** The uuid the creating client sent; `chat.postMessage` takes it as `draft_id` too. */
  client_msg_id: opt(S.String),
  date_created: opt(S.Number),
  /** Slack's update time, "1792000000.123456" (seconds with microseconds). */
  last_updated_ts: S.String,
  blocks: opt(Blocks),
  file_ids: opt(S.Array(S.String)),
  is_from_composer: opt(S.Boolean),
  is_deleted: opt(S.Boolean),
  is_sent: opt(S.Boolean),
  /** Epoch seconds; 0 when not scheduled. */
  date_scheduled: opt(S.Number),
  date_stashed: opt(S.Number),
  destinations: S.Array(DraftDestination),
})
export type Draft = typeof Draft.Type

// drafts.list

export const DraftsListArgs = S.Struct({
  is_active: opt(FormBoolean),
  /** At most 100; more answers 100 with `has_more`. */
  limit: opt(FormNumber),
  /** Exclusive: only drafts updated before it (the last draft's `last_updated_ts`). */
  next_ts: opt(S.String),
})
export type DraftsListArgs = typeof DraftsListArgs.Type

/** Newest first by `last_updated_ts`. There is no cursor in the answer. */
export const DraftsListFields = { drafts: S.Array(Draft), has_more: opt(S.Boolean) } as const

// drafts.create, drafts.update

const DraftWrite = {
  /** Always sent, also empty: `[{ type: "rich_text", elements: [] }]`. */
  blocks: FormJson(Blocks),
  destinations: FormJson(S.Array(DraftDestination)),
  file_ids: FormJson(S.Array(S.String)),
  is_from_composer: FormBoolean,
} as const

export const DraftsCreateArgs = S.Struct({ ...DraftWrite, client_msg_id: S.String })
export type DraftsCreateArgs = typeof DraftsCreateArgs.Type

export const DraftsUpdateArgs = S.Struct({
  ...DraftWrite,
  draft_id: S.String,
  /** The local edit time in epoch milliseconds, as the official client sends it. */
  client_last_updated_ts: S.String,
})
export type DraftsUpdateArgs = typeof DraftsUpdateArgs.Type

export const DraftWriteFields = { draft: Draft } as const

// drafts.delete

export const DraftsDeleteArgs = S.Struct({
  draft_id: S.String,
  client_last_updated_ts: S.String,
  /** Keep the draft's files. Juno always sends true. */
  skip_file_deletion: opt(FormBoolean),
})
export type DraftsDeleteArgs = typeof DraftsDeleteArgs.Type

export const DraftsDeleteFields = {} as const

// drafts.info: one draft, deleted and sent ones included (research section 3).

export const DraftsInfoArgs = S.Struct({ draft_id: S.String })
export type DraftsInfoArgs = typeof DraftsInfoArgs.Type

export const DraftsInfoFields = { draft: Draft } as const

// Socket events. Slack sends a client its own writes too.

export const DraftChangedEvent = S.Struct({
  type: S.Literals(['draft_create', 'draft_update']),
  draft_id: S.String,
  draft: Draft,
  event_ts: opt(S.String),
})
export type DraftChangedEvent = typeof DraftChangedEvent.Type

/** Deleted, or retired by a post that named it (`draft_send`). No draft in the payload. */
export const DraftRemovedEvent = S.Struct({
  type: S.Literals(['draft_delete', 'draft_send']),
  draft_id: S.String,
  client_msg_id: opt(S.String),
  event_ts: S.String,
})
export type DraftRemovedEvent = typeof DraftRemovedEvent.Type
