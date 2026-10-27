/**
 * Joining and leaving channels (SPEC 5 "Channel context menu", SPEC 7 "Not
 * in the channel", SPEC 10). Both change the store at once, so the sidebar
 * and an open tab follow before Slack answers, then call Slack; a refusal
 * puts the membership back and fails with Slack's code.
 *
 * `channels.join` joins a public channel. It returns no undo: its toast has
 * none. `channels.leave` leaves a public or private channel; for a public one
 * the undo joins again, for a private one there is none, as joining it again
 * needs an invite. Neither applies to a DM (`NotFound`); Juno refuses itself,
 * without asking Slack, what Slack would refuse (a private channel to join,
 * #general to leave) with Slack's own code.
 *
 * `channels.membership` is what a channel's menus need to offer Leave
 * channel, read from the store; `null` for a conversation the store does not
 * know.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { CommandResult } from './topics'

export const MembershipError = Schema.Union([NotSignedIn, NotFound, Rejected, RateLimited, Offline])
export type MembershipError = typeof MembershipError.Type

const channelPayload = { channel: Schema.String }

export const channelsJoin = Rpc.make('channels.join', { payload: channelPayload, success: CommandResult, error: MembershipError })

export const channelsLeave = Rpc.make('channels.leave', { payload: channelPayload, success: CommandResult, error: MembershipError })

export const ChannelMembership = Schema.Struct({
  member: Schema.Boolean,
  /** A channel you are in that Slack lets you leave: not a DM, not #general, not archived. */
  canLeave: Schema.Boolean,
})
export type ChannelMembership = typeof ChannelMembership.Type

export const channelsMembership = Rpc.make('channels.membership', { payload: channelPayload, success: Schema.NullOr(ChannelMembership), error: NotSignedIn })

export const MembershipRoutes = RpcGroup.make(channelsJoin, channelsLeave, channelsMembership)
