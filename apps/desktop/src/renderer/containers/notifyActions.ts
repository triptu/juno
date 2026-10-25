/**
 * Notify me (SPEC 5 and 14, inventory 15.3 and 15.6). The engine stores the choice and, on a thread, follows or
 * unfollows it; each change shows a toast with Undo.
 */
import {
  notificationsSetLevel,
  notifyChoice,
  notifyChoiceLabel,
  notifyChoiceOf,
  personMenuItems,
  threadNotifyChoice,
  type ContextMenuAt,
  type ContextMenuItem,
  type ContextMenuLeaf,
  type MenuItem,
  type NotificationSettingsView,
  type NotifyAction,
  type NotifyChoice,
  type NotifyTargetView,
} from '@juno/contract'
import { currentNotificationSettings, holdLevel, junoAvailableAtom, loadNotificationSettings, pendingLevel, popupContextMenu, registry, releaseSidebarTopic, runAction } from '@juno/state'
import { askJunoAbout, showWhatJunoKnows } from './juno/actions'
import { openNotificationsAt } from './notificationsAnchor'

/** Sets a Notify me choice: "#design-review: Never", with Undo. */
export function setNotifyLevel(target: NotifyTargetView, choice: NotifyChoice, label: string): void {
  // Following or unfollowing a thread adds or removes its row at once, even while the sidebar holds its order (SPEC 5).
  if (target.kind === 'thread') releaseSidebarTopic(registry, target.id)
  // The toast waits until the settings the menus read hold the new level. A thread's follow flag arrives with its row.
  const stored = () => loadNotificationSettings(registry, (settings) => storedChoice(settings, target, choice !== 'never') === choice)
  // Menus opened before the settings and the follow flag arrive read the choice just made.
  void holdLevel(registry, target, choice, () => runAction(registry, notificationsSetLevel, { target, choice }, { text: `${label}: ${notifyChoiceLabel(choice)}` }, stored))
}

/** The current choice for a target: the one just made while the stored state catches up, else the stored one. */
export function choiceFor(settings: NotificationSettingsView | undefined, target: NotifyTargetView, subscribed = false): NotifyChoice {
  return pendingLevel(registry, target) ?? storedChoice(settings, target, subscribed)
}

/** A target's choice as stored: the settings and, for a thread, Slack's follow flag. */
function storedChoice(settings: NotificationSettingsView | undefined, target: NotifyTargetView, subscribed: boolean): NotifyChoice {
  switch (target.kind) {
    case 'thread':
      return threadNotifyChoice(subscribed, settings?.threads[target.id])
    case 'channel':
      return notifyChoice(settings?.channels[target.id])
    case 'person':
      return notifyChoice(settings?.people[target.id])
  }
}

/** A domain menu as the native menu takes it. */
export function nativeMenu<A extends string>(items: ReadonlyArray<MenuItem<A>>, enabled: (id: A) => boolean = () => true): ContextMenuItem[] {
  return items.map((item): ContextMenuItem => {
    switch (item.type) {
      case 'separator':
        return { separator: true }
      case 'submenu':
        return { label: item.label, submenu: nativeMenu(item.items, enabled) as ContextMenuLeaf[] }
      case 'item':
        return {
          id: item.id,
          label: item.label,
          ...(enabled(item.id) ? {} : { enabled: false }),
          ...(item.checked === undefined ? {} : { checked: item.checked }),
          ...(item.sublabel === undefined ? {} : { sublabel: item.sublabel }),
        }
    }
  })
}

/** The person menu (inventory 15.6), on a sender and an @person chip: Notify me about them, then Ask Juno and What Juno knows about them while the agent runs. */
export async function showPersonMenu(person: { readonly id: string; readonly name: string }, at?: ContextMenuAt): Promise<void> {
  const settings = currentNotificationSettings(registry) ?? (await loadNotificationSettings(registry))
  const target: NotifyTargetView = { kind: 'person', id: person.id }
  const items = personMenuItems({ name: person.name, notify: choiceFor(settings, target), askJuno: registry.get(junoAvailableAtom) })
  const chosen = (await popupContextMenu(nativeMenu(items), at)) as NotifyAction | 'ask-juno' | 'juno-knows' | 'how-auto' | undefined
  if (chosen === 'how-auto') openNotificationsAt('how-auto')
  else if (chosen === 'ask-juno') askJunoAbout({ _tag: 'person', userId: person.id, name: person.name })
  else if (chosen === 'juno-knows') void showWhatJunoKnows(person)
  else if (chosen !== undefined) setNotifyLevel(target, notifyChoiceOf(chosen), person.name)
}

/**
 * The header's Follow on a thread you do not follow (SPEC 5 and 7): it
 * follows at once with Auto, set as Notify me sets it, so the
 * thread follows in Slack, joins the sidebar, and ⌘Z undoes it. Notify me
 * in ⋯ changes the level afterwards.
 */
export function followThread(thread: { readonly id: string; readonly title: string }): void {
  setNotifyLevel({ kind: 'thread', id: thread.id }, 'auto', thread.title)
}
