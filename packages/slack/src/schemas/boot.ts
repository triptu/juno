/**
 * Boot calls: `client.userBoot`, `client.counts`, `users.prefs.get` and
 * `client.getWebSocketURL`.
 *
 * Source: docs/research/slack-data-access.md section 2.
 */
import { Schema as S } from 'effect'
import { FormBoolean, FormJson, FormNumber, RawObject, Ts } from './common.ts'
import { Channel, Im } from './conversations.ts'
import { Subteam, Team, User } from './users.ts'

const opt = S.optionalKey

/**
 * User prefs. The keys Juno reads are typed; every other key is kept as
 * `unknown` so `users.prefs.set` round trips are possible later.
 */
export const UserPrefs = S.StructWithRest(
  S.Struct({
    /** Comma-separated channel ids. */
    muted_channels: opt(S.String),
    /** Comma-separated words. */
    highlight_words: opt(S.String),
    mute_sounds: opt(S.Boolean),
    show_typing: opt(S.Boolean),
    enable_unread_view: opt(S.Boolean),
    enable_threads_view: opt(S.Boolean),
    tz: opt(S.NullOr(S.String)),
    time24: opt(S.Boolean),
    locale: opt(S.String),
    all_channels_loud: opt(S.Boolean),
    channel_notification_settings: opt(S.Unknown),
    desktop_notification_actions: opt(S.Unknown),
  }),
  [RawObject],
)
export type UserPrefs = typeof UserPrefs.Type

// client.userBoot

export const ClientUserBootArgs = S.Struct({
  version_all_channels: opt(FormBoolean),
  return_all_relevant_mpdms: opt(FormBoolean),
  min_channel_updated: opt(FormNumber),
  only_self_subteams: opt(FormBoolean),
  include_min_version_bump_check: opt(FormBoolean),
})
export type ClientUserBootArgs = typeof ClientUserBootArgs.Type

export const ClientUserBootFields = {
  self: User,
  team: Team,
  prefs: opt(UserPrefs),
  /** Public and private channels plus group DMs (`is_mpim`). */
  channels: S.Array(Channel),
  ims: S.Array(Im),
  is_open: opt(S.Array(S.String)),
  starred: opt(S.Array(S.String)),
  subteams: opt(S.Struct({ self: S.Array(S.String), all: opt(S.Array(Subteam)) })),
  read_only_channels: opt(S.Array(S.String)),
  thread_only_channels: opt(S.Array(S.String)),
  channels_priority: opt(S.Unknown),
  unchanged_channel_ids: opt(S.Array(S.String)),
  has_more_mpdms: opt(S.Boolean),
  links: opt(S.Unknown),
  workspaces: opt(S.Unknown),
  default_workspace: opt(S.String),
  account_types: opt(S.Unknown),
  emoji_cache_ts: opt(S.Number),
  app_commands_cache_ts: opt(S.Number),
  paid_features: opt(S.Array(S.String)),
  can_access_client_v2: opt(S.Boolean),
  auth_min_last_fetched: opt(S.Number),
  hidden_messages_count: opt(S.Number),
  visitor_channels: opt(S.Array(S.String)),
  temporary_channel_expirations: opt(S.Unknown),
  cache_ts: opt(S.Number),
  cache_version: opt(S.String),
  dnd: opt(S.Unknown),
} as const

// client.counts

export const ClientCountsArgs = S.Struct({
  thread_counts_by_channel: opt(FormBoolean),
  org_wide_aware: opt(FormBoolean),
  include_file_channels: opt(FormBoolean),
  include_all_unreads: opt(FormBoolean),
  channel_ids: opt(FormJson(S.Array(S.String))),
  counts_last_fetched: opt(FormNumber),
})
export type ClientCountsArgs = typeof ClientCountsArgs.Type

export const CountEntry = S.Struct({
  id: S.String,
  last_read: Ts,
  latest: opt(S.NullOr(Ts)),
  has_unreads: S.Boolean,
  mention_count: S.Number,
  mention_count_display: opt(S.Number),
  vip_count: opt(S.Number),
  updated: opt(Ts),
  history_invalid: opt(Ts),
  is_muted: opt(S.Boolean),
})
export type CountEntry = typeof CountEntry.Type

export const ThreadCounts = S.Struct({
  has_unreads: S.Boolean,
  mention_count: S.Number,
  unread_count_by_channel: opt(S.Record(S.String, S.Number)),
  mention_count_by_channel: opt(S.Record(S.String, S.Number)),
  timestamp: opt(Ts),
})
export type ThreadCounts = typeof ThreadCounts.Type

export const ClientCountsFields = {
  channels: S.Array(CountEntry),
  ims: S.Array(CountEntry),
  mpims: S.Array(CountEntry),
  threads: ThreadCounts,
  channel_badges: opt(S.Record(S.String, S.Unknown)),
  alerts: opt(S.Unknown),
  saved: opt(S.Unknown),
  file_channels: opt(S.Unknown),
  counts_last_fetched: opt(S.Number),
  activity_v2: opt(S.Unknown),
} as const

// users.prefs.get

export const UsersPrefsGetArgs = S.Struct({})
export const UsersPrefsGetFields = { prefs: UserPrefs } as const

// client.getWebSocketURL

export const GetWebSocketUrlArgs = S.Struct({})
export const GetWebSocketUrlFields = {
  primary_websocket_url: S.String,
  fallback_websocket_url: opt(S.String),
  ttl_seconds: opt(S.Number),
  routing_context: opt(S.String),
} as const
