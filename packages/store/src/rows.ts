/**
 * Row shapes of the tables the sync and topics work writes and reads. Columns
 * match the migrations one to one; JSON columns are stored as strings and
 * flags as 0 or 1. Timestamps that come from Slack (`ts`, `thread_ts`,
 * `latest_reply`) are kept as Slack's strings so they sort as Slack sorts.
 */

export type Flag = 0 | 1

export interface MessageRow {
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
  readonly version: number
}

export type ConversationKind = 'public' | 'private' | 'im' | 'mpim'

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

export interface UserRow {
  readonly id: string
  readonly name: string | null
  readonly display_name: string | null
  readonly real_name: string | null
  readonly avatar_url: string | null
  readonly tz: string | null
  readonly is_bot: Flag
  readonly deleted: Flag
  readonly updated: string | null
}

export type TopicKind = 'thread' | 'main' | 'group'

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

export interface OutboxRow {
  readonly id: number
  readonly kind: string
  readonly target_key: string
  readonly payload_json: string
  readonly depends_on: string | null
  readonly created_at: string
  readonly attempts: number
  readonly next_at: string | null
  readonly last_error: string | null
}
