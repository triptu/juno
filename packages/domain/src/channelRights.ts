/**
 * What the signed-in user may change in a channel from Juno's channel
 * sheet (SPEC 5, "Channel sheet"), so menus leave out what Slack would
 * refuse. Slack's own client asks the server per channel (edge
 * `permissions/info`, research `slack-channels.md`); a menu cannot wait for
 * that, so this reads what the store knows and errs towards showing: Slack
 * still refuses what a workspace's settings forbid, and the sheet says so.
 */
import { isDm, type ConversationKind } from './channel'

/** The user's place in the workspace, from `client.userBoot`'s `self`. Guests include single-channel guests. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest'

export interface ChannelRightsInput {
  readonly kind: ConversationKind
  readonly archived: boolean
  /** The user is in the channel: Slack refuses a rename or an invite from outside (`not_in_channel`). */
  readonly member: boolean
  /** The workspace's general channel: everyone is in it, and no one is removed. */
  readonly general: boolean
  /** Shared with another organisation (Slack Connect). */
  readonly externallyShared: boolean
  readonly createdByUser: boolean
  /** Unknown until the first boot stored it. */
  readonly role: WorkspaceRole | undefined
}

/**
 * Nothing in a DM, a group DM, an archived channel or one the user is not
 * in, and nothing for a guest. A Slack Connect channel only for an admin or
 * owner or the person who made it. In the general channel only an admin or
 * owner renames, and members are not changed. Elsewhere both.
 */
export function channelEditRights(channel: ChannelRightsInput): { readonly rename: boolean; readonly members: boolean } {
  if (isDm(channel.kind) || channel.archived || !channel.member || channel.role === 'guest') return { rename: false, members: false }
  const admin = channel.role === 'owner' || channel.role === 'admin'
  if (channel.externallyShared && !admin && !channel.createdByUser) return { rename: false, members: false }
  if (channel.general) return { rename: admin, members: false }
  return { rename: true, members: true }
}
