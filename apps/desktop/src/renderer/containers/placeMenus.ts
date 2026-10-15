/**
 * The channel menu (inventory 15.2) on the header's context pill and a
 * #channel chip, and the person menu (15.6) on a sender's name or avatar and
 * an @person chip. Ask Juno opens the Juno panel, or the Juno tab, with an
 * About chip (SPEC 7). Mark channel as read and unread wait for an engine
 * command, so they show disabled.
 */
import { channelMenuItems, channelsIgnore, personMenuItems, type ChannelMenuAction, type ContextMenuItem, type MenuItem, type RowChannel } from '@juno/contract'
import { junoAgentOnAtom, popupContextMenu, registry, runAction, sidebarFilterAtom } from '@juno/state'
import { markFilterChange } from './filterMark'
import { askJunoAbout } from './juno/actions'
import { openTopic } from './navigation'

/** A channel as the menus know it: the pill's channel, or a chip's name with what the window's refs say. */
export type MenuChannel = Pick<RowChannel, 'id' | 'kind' | 'name' | 'label' | 'tint'> & {
  /** The channel's Main topic, when it has one. */
  readonly mainId?: string
}

const pending = new Set<ChannelMenuAction>(['mark-channel-read', 'mark-channel-unread'])

function nativeItems<A extends string>(items: ReadonlyArray<MenuItem<A>>, disabled: ReadonlySet<A> = new Set()): ContextMenuItem[] {
  return items.flatMap((item): ContextMenuItem[] => {
    if (item.type === 'separator') return [{ separator: true }]
    if (item.type === 'submenu') return []
    return [{ id: item.id, label: item.label, ...(disabled.has(item.id) ? { enabled: false } : {}) }]
  })
}

/** Narrows the sidebar to the channel, as the pill's click does. */
export function scopeToChannel(channel: string): void {
  markFilterChange()
  registry.set(sidebarFilterAtom, { ...registry.get(sidebarFilterAtom), scope: channel })
}

export async function showChannelMenu(channel: MenuChannel): Promise<void> {
  const askJuno = registry.get(junoAgentOnAtom)
  const items = channelMenuItems({ channel: { id: channel.id as never, kind: channel.kind, name: channel.name }, hasMain: channel.mainId !== undefined, askJuno })
  const chosen = (await popupContextMenu(nativeItems(items, pending))) as ChannelMenuAction | undefined
  switch (chosen) {
    case 'show-topics':
      return scopeToChannel(channel.id)
    case 'open-main':
      if (channel.mainId !== undefined) openTopic(channel.mainId)
      return
    case 'ignore-channel':
      return void runAction(registry, channelsIgnore, { channel: channel.id }, { text: `Ignoring ${channel.label}` })
    case 'ask-juno':
      return askJunoAbout({ _tag: 'channel', channelId: channel.id, name: channel.name, tint: channel.tint })
  }
}

export async function showPersonMenu(person: { readonly id: string; readonly name: string }): Promise<void> {
  const items = personMenuItems({ askJuno: registry.get(junoAgentOnAtom) })
  if (items.length === 0) return
  const chosen = await popupContextMenu(nativeItems(items))
  if (chosen === 'ask-juno') askJunoAbout({ _tag: 'person', userId: person.id, name: person.name })
}
