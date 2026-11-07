import type { RowChannel } from '@juno/contract'
import { registry, sidebarFilterAtom, sidebarPaneAtom } from '@juno/state'
import { chunk } from './chunks'
import { markFilterChange } from './filterMark'

/** A channel as the menus know it: the pill's channel, or a chip's name with what the window's refs say. */
export type MenuChannel = Pick<RowChannel, 'id' | 'kind' | 'name' | 'label' | 'tint'> & {
  /** The channel's Main topic, when it has one. */
  readonly mainId?: string
}

/** Narrows the sidebar to the channel, as the pill's click does. */
export function scopeToChannel(channel: string): void {
  markFilterChange()
  // The scope wins over a view, so the view's pill gives way to All.
  const { view: _view, ...filter } = registry.get(sidebarFilterAtom)
  registry.set(sidebarFilterAtom, { ...filter, scope: channel })
  registry.set(sidebarPaneAtom, 'topics')
}

const menu = chunk(() => import('./ChannelMenu'))
export const loadChannelMenu = menu.load

export async function showChannelMenu(...args: Parameters<typeof import('./ChannelMenu').showChannelMenu>) {
  return (await menu.load()).showChannelMenu(...args)
}
