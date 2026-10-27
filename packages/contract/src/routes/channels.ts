/**
 * Making and editing channels in Slack (SPEC 5, "Channel sheet"; research
 * `slack-channels.md`).
 *
 * `channels.create` makes a channel and invites its members, then answers
 * with the channel stored as the socket's `channel_joined` would store it,
 * so its Main opens at once. A refused name fails with Slack's code and
 * nothing is made; members Slack would not add are listed in the answer,
 * since the channel exists by then.
 *
 * `channels.edit` renames a channel and adds and removes members. The new
 * name shows everywhere at once and goes back if Slack refuses it. The
 * answer says what Slack refused, and the undo puts back what was done.
 *
 * `channels.rights` says what the signed-in user may change in a channel,
 * from the store alone, so a menu can leave out what Slack would refuse.
 * `channels.members` asks Slack for a channel's members, for the sheet.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { Person } from '../refs'
import { UndoCommand } from './topics'

// The name rule is `@juno/domain`'s; the renderer reaches it here.
export { normalizeChannelName } from '@juno/domain'

/** Why a change was not made: Slack's refusal (its code), no connection, a rate limit, no session, or a channel the store does not know. */
export const ChannelError = Schema.Union([NotSignedIn, NotFound, Rejected, Offline, RateLimited])
export type ChannelError = typeof ChannelError.Type

/** A person Slack would not add or remove, and its code (`cant_invite`, `user_is_restricted`, …). */
export const ChannelMemberIssue = Schema.Struct({ person: Person, code: Schema.String })
export type ChannelMemberIssue = typeof ChannelMemberIssue.Type

export const ChannelCreated = Schema.Struct({
  channelId: Schema.String,
  /** Its Main, to open. */
  topicId: Schema.String,
  /** The name Slack gave it, without "#". */
  name: Schema.String,
  /** Members who could not be added. */
  notAdded: Schema.Array(ChannelMemberIssue),
})
export type ChannelCreated = typeof ChannelCreated.Type

/** Makes a channel and invites `members` (user ids). The name is normalised as Slack does first. */
export const channelsCreate = Rpc.make('channels.create', {
  payload: { name: Schema.String, isPrivate: Schema.Boolean, members: Schema.Array(Schema.String) },
  success: ChannelCreated,
  error: ChannelError,
})

export const ChannelEdited = Schema.Struct({
  /** The name the channel has now, without "#". */
  name: Schema.String,
  /** Slack's code when it refused the new name; the old name is back. */
  renameRefused: Schema.optionalKey(Schema.String),
  notAdded: Schema.Array(ChannelMemberIssue),
  notRemoved: Schema.Array(ChannelMemberIssue),
  /** Puts back what was changed. Absent when nothing changed. */
  undo: Schema.optionalKey(UndoCommand),
})
export type ChannelEdited = typeof ChannelEdited.Type

/** Renames a channel (`name` absent or the same keeps it) and adds and removes members (user ids). */
export const channelsEdit = Rpc.make('channels.edit', {
  payload: { channel: Schema.String, name: Schema.optionalKey(Schema.String), add: Schema.Array(Schema.String), remove: Schema.Array(Schema.String) },
  success: ChannelEdited,
  error: ChannelError,
})

/** What the user may change in a channel. Both false for a DM, a group DM or an archived channel. */
export const ChannelRights = Schema.Struct({ rename: Schema.Boolean, members: Schema.Boolean })
export type ChannelRights = typeof ChannelRights.Type

export const channelsRights = Rpc.make('channels.rights', { payload: { channel: Schema.String }, success: ChannelRights, error: NotSignedIn })

/** The channel's other members, by name. The user is left out: leaving is not an edit. */
export const channelsMembers = Rpc.make('channels.members', { payload: { channel: Schema.String }, success: Schema.Array(Person), error: ChannelError })

export const ChannelsRoutes = RpcGroup.make(channelsCreate, channelsEdit, channelsRights, channelsMembers)
