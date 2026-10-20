/**
 * The huddle item of a channel's topic and channel menus (SPEC 20). Its
 * header shows the huddle control only while a huddle runs, so Start huddle
 * lives in these menus. A DM has the control in its header and no item.
 * Reads small atoms only; the call's chunk loads when the item is chosen.
 */
import type { HuddleMenuItem, RowChannel } from '@juno/contract'
import { huddleCallValueAtom, huddleInChannelAtom, registry } from '@juno/state'

/** Start huddle, Join huddle while one runs there, or nothing in a DM or while you are in this huddle. */
export function huddleMenuItem(channel: Pick<RowChannel, 'id' | 'kind'>): HuddleMenuItem | undefined {
  if (channel.kind !== 'public' && channel.kind !== 'private') return undefined
  const call = registry.get(huddleCallValueAtom)
  if (call !== undefined && (call.phase === 'joining' || call.phase === 'joined') && call.channelId === channel.id) return undefined
  return registry.get(huddleInChannelAtom(channel.id)) === undefined ? 'start' : 'join'
}

/** Starts or joins the channel's huddle, as the header's control does. */
export function joinHuddleFromMenu(channelId: string): void {
  void import('./media').then((media) => media.joinHuddle(channelId))
}
