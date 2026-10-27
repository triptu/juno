/**
 * The channel sheet's actions (SPEC 5, "Channel sheet"): New channel… from
 * ⌘K, Edit channel… from a channel's menu, and the words for what Slack
 * said. Create waits for Slack and keeps the sheet open on a refusal;
 * Save closes the sheet at once, since a rename shows everywhere as soon as
 * the engine has it, and the toast follows Slack's answer. What only the
 * open sheet needs is in `channelSheetActions.ts`, in the sheet's chunk.
 */
import { channelsRights, normalizeChannelName, type ChannelRights, type PickConversation } from '@juno/contract'
import { channelSheetAtom, registry, runCommand } from '@juno/state'

/** New channel…, with the name typed in ⌘K when it came from there. */
export function openNewChannel(name = ''): void {
  registry.set(channelSheetAtom, { mode: 'new', name })
}

/** Edit channel… on a channel the user may change, with what they may change in it. */
export function openEditChannel(channel: { readonly id: string; readonly name: string }, rights: ChannelRights): void {
  registry.set(channelSheetAtom, { mode: 'edit', channelId: channel.id, name: channel.name, rename: rights.rename, members: rights.members })
}

/** Edit channel… from a menu or a toast: what the user may change is asked as it opens. */
export async function editChannel(channel: { readonly id: string; readonly name: string }): Promise<void> {
  const rights = await channelRights(channel.id)
  if (rights.rename || rights.members) openEditChannel(channel, rights)
}

/** Whether a channel's menu offers Edit channel…: a channel, not a DM, where the user may change something. */
export async function canEditChannel(channel: { readonly id: string; readonly kind: string }): Promise<boolean> {
  if (channel.kind !== 'public' && channel.kind !== 'private') return false
  const rights = await channelRights(channel.id)
  return rights.rename || rights.members
}

export function closeChannelSheet(): void {
  registry.set(channelSheetAtom, undefined)
}

/** ⌘K's New channel row: the text as Slack will take it, when it names no channel among the rows and is a name at all. */
export function newChannelName(text: string, picks: ReadonlyArray<PickConversation> | undefined): string | undefined {
  if (text === '' || picks === undefined || picks.some((pick) => pick.kind === 'public' || pick.kind === 'private')) return undefined
  const { name } = normalizeChannelName(text)
  return name === '' ? undefined : name
}

const none: ChannelRights = { rename: false, members: false }

/** What the user may change in a channel, for its menu. Nothing when the engine cannot say. */
export async function channelRights(channel: string): Promise<ChannelRights> {
  const exit = await runCommand(registry, channelsRights, { channel })
  return exit._tag === 'Success' ? exit.value : none
}
