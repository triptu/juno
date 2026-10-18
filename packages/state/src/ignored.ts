/**
 * The ignore list on Settings › Ignored (SPEC 14, inventory 14). A channel is
 * ignored from its menu, Home's Ignore review or the page's add row; the page
 * lists what is ignored and stops ignoring it, with Undo.
 */
import { channelsIgnorable, channelsIgnore, channelsIgnored, channelsUnignore, type IgnoredChannel } from '@juno/contract'
import { liveQuery } from './atoms'
import type { Registry } from './client'
import { runAction } from './undo'

export const ignoredChannelsAtom = liveQuery(channelsIgnored)(undefined)

/** The channels the add row offers: yours, not ignored. */
export const ignorableChannelsAtom = liveQuery(channelsIgnorable)(undefined)

/** Ignores a channel; the toast's Undo shows it again. `label` is the channel as the toast names it, "#deploys". */
export function ignoreChannel(registry: Registry, channel: { readonly id: string; readonly label: string }): Promise<boolean> {
  return runAction(registry, channelsIgnore, { channel: channel.id }, { text: `Ignoring ${channel.label}` })
}

/** Stops ignoring a channel; the toast's Undo ignores it again. */
export function stopIgnoring(registry: Registry, channel: IgnoredChannel): Promise<boolean> {
  return runAction(registry, channelsUnignore, { channel: channel.id }, { text: `Stopped ignoring #${channel.name}` })
}
