/**
 * Row shapes of the tables the sync and topics work writes and reads. Columns
 * match the migrations one to one; JSON columns are stored as strings and
 * flags as 0 or 1. Timestamps that come from Slack (`ts`, `thread_ts`,
 * `latest_reply`) are kept as Slack's strings so they sort as Slack sorts;
 * compare them with `compareTs` from `@juno/slack-schema`, never with `<`.
 */
import type { ConversationKind, TopicKind } from '@juno/domain'

export type { ConversationKind, TopicKind }

export type Flag = 0 | 1

export interface MessageRow {
  /** Derived by reindex: 0 none, 1 broadcast, 2 direct or own user group; null until derived. Optional on incoming rows. */
  readonly attention?: number | null
  readonly attention_context?: string | null
  readonly bot_name: string | null
  readonly bot_icon: string | null
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly user_id: string | null
  readonly subtype: string | null
  readonly text: string
  readonly blocks_json: string | null
  readonly files_json: string | null
  readonly attachments_json: string | null
  readonly edited_ts: string | null
  readonly deleted: Flag
  readonly client_msg_id: string | null
  readonly reply_count: number
  readonly latest_reply: string | null
  readonly reply_users_json: string | null
  readonly last_event_ts: string | null
  /** 1 when the content came from a search match: no reactions, files or blocks yet (`@juno/sync` merge rules). */
  readonly partial: Flag
  readonly version: number
  /** 1 for a message shown only to the signed-in user, which Slack sends only on the socket. Absent means 0. */
  readonly ephemeral?: Flag
  /** The app's `bot_id`, for a message an app sent. Absent means unknown. */
  readonly bot_id?: string | null
}

export interface ConversationRow {
  readonly id: string
  readonly kind: ConversationKind
  readonly name: string | null
  readonly user_id: string | null
  readonly member_ids_json: string | null
  readonly is_member: Flag
  readonly is_archived: Flag
  readonly topic: string | null
  readonly purpose: string | null
  readonly created: string | null
  readonly updated: string | null
}

/** A user group, by its `S…` id. `deleted` groups keep their last handle. */
export interface UsergroupRow {
  readonly id: string
  readonly handle: string
  readonly name: string | null
  readonly deleted: Flag
}

export interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_small_url?: string | null
  readonly avatar_large_url?: string | null
  readonly avatar_url: string | null
  readonly tz: string | null
  readonly is_bot: Flag
  readonly deleted: Flag
  readonly updated: string | null
}

export interface TopicIndexRow {
  readonly topic_id: string
  readonly channel: string
  readonly kind: TopicKind
  readonly last_activity_ts: string | null
  readonly message_count: number
  readonly participants_json: string | null
  readonly root_ts: string | null
  readonly unread_count: number
  readonly unread_exact: Flag
  readonly mentions_me: Flag
  readonly preview_json: string | null
  readonly rev: number
}

export interface SyncedRangeRow {
  readonly channel: string
  readonly from_ts: string
  readonly to_ts: string
}

/** `topic_art`: one drawing, or one finished attempt, per topic (user.db). */
export interface TopicArtRow {
  readonly topic_id: string
  /** The canonical recipe; empty for a failed attempt. */
  readonly recipe: string
  readonly recipe_hash: string
  readonly input_hash: string
  readonly model: string
  /** `ok` is shown; `unsure` and `failed` keep the placeholder and stop the topic being tried again. */
  readonly status: 'ok' | 'unsure' | 'failed'
  readonly hue: string
  /** The title the drawing was made from: `manual`, `ai`, `fallback` or `channel`. */
  readonly title_source: string
  readonly source: 'ai' | 'redraw'
  /** Epoch milliseconds, as a string like the other timestamps. */
  readonly created_at: string
}
