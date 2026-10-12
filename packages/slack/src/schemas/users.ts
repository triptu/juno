/**
 * Users, teams, usergroups and the edge (Flannel) `users/info` call.
 *
 * Source: docs/research/slack-data-access.md sections 1 (edge transport) and 3.
 */
import { Schema as S } from 'effect'
import { ErrorResponse } from './common.ts'

const opt = S.optionalKey

export const UserProfile = S.Struct({
  display_name: opt(S.String),
  display_name_normalized: opt(S.String),
  real_name: opt(S.String),
  real_name_normalized: opt(S.String),
  first_name: opt(S.String),
  last_name: opt(S.String),
  title: opt(S.String),
  email: opt(S.String),
  phone: opt(S.String),
  team: opt(S.String),
  avatar_hash: opt(S.String),
  is_custom_image: opt(S.Boolean),
  image_24: opt(S.String),
  image_32: opt(S.String),
  image_48: opt(S.String),
  image_72: opt(S.String),
  image_192: opt(S.String),
  image_512: opt(S.String),
  image_original: opt(S.String),
  status_text: opt(S.String),
  status_emoji: opt(S.String),
  status_expiration: opt(S.Number),
  bot_id: opt(S.String),
  api_app_id: opt(S.String),
  always_active: opt(S.Boolean),
})
export type UserProfile = typeof UserProfile.Type

export const User = S.Struct({
  id: S.String,
  team_id: opt(S.String),
  name: opt(S.String),
  real_name: opt(S.String),
  deleted: opt(S.Boolean),
  color: opt(S.String),
  tz: opt(S.NullOr(S.String)),
  tz_label: opt(S.String),
  tz_offset: opt(S.Number),
  profile: opt(UserProfile),
  is_admin: opt(S.Boolean),
  is_owner: opt(S.Boolean),
  is_primary_owner: opt(S.Boolean),
  is_bot: opt(S.Boolean),
  is_app_user: opt(S.Boolean),
  is_restricted: opt(S.Boolean),
  is_ultra_restricted: opt(S.Boolean),
  is_stranger: opt(S.Boolean),
  is_email_confirmed: opt(S.Boolean),
  updated: opt(S.Number),
  presence: opt(S.String),
  locale: opt(S.String),
  who_can_share_contact_card: opt(S.String),
})
export type User = typeof User.Type

export const Team = S.Struct({
  id: S.String,
  name: S.String,
  domain: S.String,
  email_domain: opt(S.String),
  url: opt(S.String),
  icon: opt(S.Record(S.String, S.Unknown)),
  avatar_base_url: opt(S.String),
  is_verified: opt(S.Boolean),
  enterprise_id: opt(S.String),
  enterprise_name: opt(S.String),
  enterprise_domain: opt(S.String),
  plan: opt(S.String),
  prefs: opt(S.Record(S.String, S.Unknown)),
})
export type Team = typeof Team.Type

/** A usergroup (`<!subteam^S…>` in text). */
export const Subteam = S.Struct({
  id: S.String,
  team_id: opt(S.String),
  name: S.String,
  handle: S.String,
  description: opt(S.String),
  is_usergroup: opt(S.Boolean),
  is_subteam: opt(S.Boolean),
  is_external: opt(S.Boolean),
  users: opt(S.Array(S.String)),
  user_count: opt(S.Number),
  date_create: opt(S.Number),
  date_update: opt(S.Number),
  date_delete: opt(S.Number),
  created_by: opt(S.String),
  updated_by: opt(S.String),
  deleted_by: opt(S.NullOr(S.String)),
  auto_type: opt(S.NullOr(S.String)),
  prefs: opt(S.Unknown),
})
export type Subteam = typeof Subteam.Type

// Edge API. JSON body with the token inside, POST <flannel url>/users/info?_x_app_name=client.

export const EdgeUsersInfoArgs = S.Struct({
  token: S.String,
  ids: opt(S.Array(S.String)),
  updated_ids: opt(S.Record(S.String, S.Number)),
  check_membership: opt(S.Boolean),
  check_interaction: opt(S.Boolean),
  include_profile_only_users: opt(S.Boolean),
})
export type EdgeUsersInfoArgs = typeof EdgeUsersInfoArgs.Type

export const EdgeUsersInfoOk = S.Struct({
  ok: S.Literal(true),
  results: S.Array(User),
  failed_ids: opt(S.Array(S.String)),
  pending_ids: opt(S.Array(S.String)),
  invalid_ids: opt(S.Array(S.String)),
  disconnected_ids: opt(S.Array(S.String)),
  can_interact: opt(S.Unknown),
  member_channels: opt(S.Unknown),
  mpims: opt(S.Unknown),
  next_marker: opt(S.String),
})
export const EdgeUsersInfoResponse = S.Union([EdgeUsersInfoOk, ErrorResponse])
export type EdgeUsersInfoResponse = typeof EdgeUsersInfoResponse.Type
