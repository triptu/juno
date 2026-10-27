/**
 * Joining and leaving channels (SPEC 5, 7 and 10). The engine changes the
 * membership at once, so the sidebar and an open tab follow before Slack
 * answers; these show the toast once it has. Leaving a public channel keeps
 * its undo, which joins again; a private one has none, as joining it again
 * needs an invite.
 */
import { Exit } from 'effect'
import { channelsJoin, channelsLeave, channelsMembership, type ChannelMembership, type CommandResult } from '@juno/contract'
import { runCommand } from './atoms'
import type { Registry } from './client'
import { errorOf } from './result'
import type { MembershipChannel } from './channels'
import { runActionExit, showToast } from './undo'

/** Why Slack, or Juno for it, said no, in plain words. */
function reason(error: { readonly _tag: string; readonly code?: string } | undefined): string {
  if (error?._tag === 'Rejected') return REFUSALS[error.code ?? ''] ?? 'Slack refused'
  return (error === undefined ? undefined : PROBLEMS[error._tag]) ?? 'Something went wrong'
}

const PROBLEMS: Readonly<Record<string, string>> = {
  Offline: 'You’re offline',
  RateLimited: 'Slack asked us to slow down',
  NotSignedIn: 'You’re signed out',
  NotFound: 'Slack doesn’t know this channel',
}

const REFUSALS: Readonly<Record<string, string>> = {
  is_archived: 'The channel is archived',
  cant_leave_general: 'Everyone stays in this channel',
  last_member: 'You’re its last member',
  method_not_supported_for_channel_type: 'You need an invite',
  channel_not_found: 'Slack doesn’t know this channel',
  restricted_action: 'Your workspace doesn’t allow it',
  not_allowed_token_type: 'Your workspace doesn’t allow it',
}

/** Joins a public channel: "Joined #eng", or why not. */
export async function joinChannel(registry: Registry, channel: MembershipChannel): Promise<boolean> {
  const exit = await runCommand(registry, channelsJoin, { channel: channel.id })
  showToast(registry, { text: Exit.isSuccess(exit) ? `Joined ${channel.label}` : `Couldn’t join ${channel.label} · ${reason(errorOf(exit))}` })
  return Exit.isSuccess(exit)
}

/** Leaves a channel: "Left #eng" with Undo for a public one, or why not. */
export async function leaveChannel(registry: Registry, channel: MembershipChannel): Promise<boolean> {
  const text = `Left ${channel.label}`
  const exit = (await runActionExit(registry, channelsLeave, { channel: channel.id }, { text })) as Exit.Exit<CommandResult, { readonly _tag: string }>
  if (Exit.isFailure(exit)) showToast(registry, { text: `Couldn’t leave ${channel.label} · ${reason(errorOf(exit))}` })
  else if (exit.value.undo === undefined) showToast(registry, { text })
  return Exit.isSuccess(exit)
}

/** What a channel's menus need for Leave channel, from the store; undefined when the engine could not say. */
export async function channelMembership(registry: Registry, channel: string): Promise<ChannelMembership | undefined> {
  const exit = await runCommand(registry, channelsMembership, { channel })
  return Exit.isSuccess(exit) ? (exit.value ?? undefined) : undefined
}
