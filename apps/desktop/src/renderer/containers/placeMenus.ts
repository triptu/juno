/**
 * The channel menu (inventory 15.2) on the header's context pill and a
 * #channel chip. Its Notify me sets the channel's level; Ask Juno opens the
 * Juno panel, or the Juno tab, with an About chip (SPEC 7). Mark channel as
 * read and unread wait for an engine command, so they show disabled. Add to
 * view (inventory 15.8) adds the channel to a sidebar view or removes it. The
 * person menu is `notifyActions.showPersonMenu`.
 */
import { channelMenuItems, channelsIgnore, isViewMenuAction, notifyChoiceOf, type ChannelMenuAction, type NotifyAction, type NotifyTargetView, type RowChannel } from '@juno/contract'
import { currentNotificationSettings, junoAvailableAtom, loadNotificationSettings, popupContextMenu, registry, runAction, sidebarFilterAtom } from '@juno/state'
import { markFilterChange } from './filterMark'
import { askJunoAbout } from './juno/actions'
import { openTopic } from './navigation'
import { choiceFor, nativeMenu, setNotifyLevel } from './notifyActions'
import { runViewMenuAction, viewChoices } from './viewActions'

/** A channel as the menus know it: the pill's channel, or a chip's name with what the window's refs say. */
export type MenuChannel = Pick<RowChannel, 'id' | 'kind' | 'name' | 'label' | 'tint'> & {
  /** The channel's Main topic, when it has one. */
  readonly mainId?: string
}

const pending: ReadonlySet<string> = new Set<ChannelMenuAction>(['mark-channel-read', 'mark-channel-unread'])

const isNotify = (action: ChannelMenuAction): action is NotifyAction => action.startsWith('notify-')

/** Narrows the sidebar to the channel, as the pill's click does. */
export function scopeToChannel(channel: string): void {
  markFilterChange()
  // The scope wins over a view, so the view's pill gives way to All.
  const { view: _view, ...filter } = registry.get(sidebarFilterAtom)
  registry.set(sidebarFilterAtom, { ...filter, scope: channel })
}

export async function showChannelMenu(channel: MenuChannel): Promise<void> {
  const settings = currentNotificationSettings(registry) ?? (await loadNotificationSettings(registry))
  const target: NotifyTargetView = { kind: 'channel', id: channel.id }
  const items = channelMenuItems({
    channel: { id: channel.id as never, kind: channel.kind, name: channel.name },
    hasMain: channel.mainId !== undefined,
    notify: choiceFor(settings, target),
    views: viewChoices(channel.id),
    askJuno: registry.get(junoAvailableAtom),
  })
  const chosen = (await popupContextMenu(nativeMenu(items, (id) => !pending.has(id)))) as ChannelMenuAction | undefined
  if (chosen === undefined) return
  if (isNotify(chosen)) return setNotifyLevel(target, notifyChoiceOf(chosen), channel.label)
  if (isViewMenuAction(chosen)) return runViewMenuAction(chosen, channel)
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
