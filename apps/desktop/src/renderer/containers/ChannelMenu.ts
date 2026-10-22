/**
 * The channel menu (inventory 15.2) on the header's context pill and a
 * #channel chip. Its Notify me sets the channel's level; Ask Juno opens the
 * Juno panel, or the Juno tab, with an About chip (SPEC 7). Mark channel as
 * read and unread wait for an engine command, so they show disabled. Add to
 * view (inventory 15.8) adds the channel to a sidebar view or removes it. The
 * person menu is `notifyActions.showPersonMenu`.
 */
import { channelMenuItems, isViewMenuAction, notifyChoiceOf, type ChannelMenuAction, type ContextMenuAt, type NotifyAction, type NotifyTargetView } from '@juno/contract'
import { currentNotificationSettings, ignoreChannel, junoAvailableAtom, loadNotificationSettings, popupContextMenu, registry } from '@juno/state'
import { scopeToChannel, type MenuChannel } from './placeMenus'
import { huddleMenuItem, joinHuddleFromMenu } from './huddle/menuItem'
import { askJunoAbout } from './juno/actions'
import { openTopic } from './navigation'
import { choiceFor, nativeMenu, setNotifyLevel } from './notifyActions'
import { runViewMenuAction, viewChoices } from './viewActions'

const pending: ReadonlySet<string> = new Set<ChannelMenuAction>(['mark-channel-read', 'mark-channel-unread'])

const isNotify = (action: ChannelMenuAction): action is NotifyAction => action.startsWith('notify-')

/** Shows the menu at the pointer, or at `at`. Resolves with the chosen action once it has run. */
export async function showChannelMenu(channel: MenuChannel, at?: ContextMenuAt): Promise<ChannelMenuAction | undefined> {
  const settings = currentNotificationSettings(registry) ?? (await loadNotificationSettings(registry))
  const target: NotifyTargetView = { kind: 'channel', id: channel.id }
  const huddle = huddleMenuItem(channel)
  const items = channelMenuItems({
    channel: { id: channel.id as never, kind: channel.kind, name: channel.name },
    hasMain: channel.mainId !== undefined,
    notify: choiceFor(settings, target),
    views: viewChoices(channel.id),
    askJuno: registry.get(junoAvailableAtom),
    ...(huddle === undefined ? {} : { huddle }),
  })
  const chosen = (await popupContextMenu(nativeMenu(items, (id) => !pending.has(id)), at)) as ChannelMenuAction | undefined
  if (chosen !== undefined) await runChannelAction(chosen, channel, target)
  return chosen
}

async function runChannelAction(chosen: ChannelMenuAction, channel: MenuChannel, target: NotifyTargetView): Promise<void> {
  if (isNotify(chosen)) return setNotifyLevel(target, notifyChoiceOf(chosen), channel.label)
  if (isViewMenuAction(chosen)) return runViewMenuAction(chosen, channel)
  switch (chosen) {
    case 'show-topics':
      return scopeToChannel(channel.id)
    case 'huddle':
      return joinHuddleFromMenu(channel.id)
    case 'open-main':
      if (channel.mainId !== undefined) openTopic(channel.mainId)
      return
    case 'ignore-channel':
      return void ignoreChannel(registry, channel)
    case 'ask-juno':
      return askJunoAbout({ _tag: 'channel', channelId: channel.id, name: channel.name, tint: channel.tint })
  }
}
