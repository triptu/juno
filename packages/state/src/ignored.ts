/**
 * The ignore list on Settings › Ignored (SPEC 14, inventory 14). Ignoring happens
 * from a channel's menu; here the owner sees what is ignored and stops
 * ignoring it, with Undo.
 */
import { channelsIgnored, channelsUnignore, type IgnoredChannel } from '@juno/contract'
import { liveQuery } from './atoms'
import type { Registry } from './client'
import { runAction } from './undo'

export const ignoredChannelsAtom = liveQuery(channelsIgnored)(undefined)

/** Stops ignoring a channel; the toast's Undo ignores it again. */
export function stopIgnoring(registry: Registry, channel: IgnoredChannel): Promise<boolean> {
  return runAction(registry, channelsUnignore, { channel: channel.id }, { text: `Stopped ignoring #${channel.name}` })
}
