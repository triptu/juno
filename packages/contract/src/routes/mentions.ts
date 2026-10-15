/**
 * @ and # suggestions in the composer (spec section 8, inventory 7.1).
 *
 * Live queries, which never call Slack:
 * - `mentions.people`: the people matching `query`, at most
 *   `SUGGESTION_LIMIT`, ranked: people in this conversation first (who
 *   posted in the thread or the channel lately, a DM's partner, a group
 *   DM's members), then recent contacts (your DMs and group DMs by latest
 *   activity), then everyone else. A query matches the display name, the
 *   real name and the handle by word start.
 * - `mentions.channels`: the channels matching `query`, yours first. DMs
 *   and group DMs are not offered.
 *
 * Each row carries its `tier`, `order` and `names`, so the renderer can
 * narrow the last answer at once while the next one is on its way
 * (`rankSuggestions`).
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ChannelColor } from '@juno/domain'
import { liveValueRoute } from '../live'

export const MentionPerson = Schema.Struct({
  id: Schema.String,
  /** The display name: what the token shows after "@". */
  name: Schema.String,
  /** The real name, shown after the display name when it differs. */
  realName: Schema.optionalKey(Schema.String),
  avatarUrl: Schema.optionalKey(Schema.String),
  color: ChannelColor,
  /** 0 in this conversation, 1 a recent contact, 2 everyone else. */
  tier: Schema.Int,
  /** The place inside the tier, most recent first. */
  order: Schema.Int,
  /** What a query matches: display name, real name, handle. */
  names: Schema.Array(Schema.String),
})
export type MentionPerson = typeof MentionPerson.Type

export const MentionChannel = Schema.Struct({
  id: Schema.String,
  /** Without "#". */
  name: Schema.String,
  kind: Schema.Literals(['public', 'private']),
  /** 0 a channel you are in, 1 one you are not. */
  tier: Schema.Int,
  order: Schema.Int,
  names: Schema.Array(Schema.String),
})
export type MentionChannel = typeof MentionChannel.Type

export const mentionsPeople = liveValueRoute('mentions.people', {
  payload: { channel: Schema.optionalKey(Schema.String), threadTs: Schema.optionalKey(Schema.String), query: Schema.String },
  value: Schema.Array(MentionPerson),
})

export const mentionsChannels = liveValueRoute('mentions.channels', {
  payload: { query: Schema.String },
  value: Schema.Array(MentionChannel),
})

/** Workspace emoji loaded once, then filtered locally by the composer. */
export const mentionsEmoji = liveValueRoute('mentions.emoji', {
  value: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.NullOr(Schema.String), alias_for: Schema.NullOr(Schema.String) })),
})

export const MentionsRoutes = RpcGroup.make(mentionsPeople, mentionsChannels, mentionsEmoji)
