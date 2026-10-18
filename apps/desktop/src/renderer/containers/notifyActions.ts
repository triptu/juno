/**
 * Notify me and the why popover (SPEC 5 and 14, inventory 15.3, 15.4 and
 * 15.6). The engine stores the choice and, on a thread, follows or
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
  type Why,
} from '@juno/contract'
import { currentNotificationSettings, junoAvailableAtom, loadNotificationSettings, popupContextMenu, registry, releaseSidebarTopic, runAction, whyPopoverAtom } from '@juno/state'
import { askJunoAbout, showWhatJunoKnows } from './juno/actions'
import { openSettings } from './navigation'

/** Sets a Notify me choice: "#design-review: Never", with Undo. */
export function setNotifyLevel(target: NotifyTargetView, choice: NotifyChoice, label: string): void {
  // Following or unfollowing a thread adds or removes its row at once, even while the sidebar holds its order (SPEC 5).
  if (target.kind === 'thread') releaseSidebarTopic(registry, target.id)
  // The toast waits until the settings the menus read hold the new level. A thread's follow flag arrives with its row.
  const stored = () => loadNotificationSettings(registry, (settings) => choiceFor(settings, target, choice !== 'never') === choice)
  void runAction(registry, notificationsSetLevel, { target, choice }, { text: `${label}: ${notifyChoiceLabel(choice)}` }, stored)
}

/** The current choice for a target, from the settings and, for a thread, Slack's follow flag. */
export function choiceFor(settings: NotificationSettingsView | undefined, target: NotifyTargetView, subscribed = false): NotifyChoice {
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
  const chosen = (await popupContextMenu(nativeMenu(items), at)) as NotifyAction | 'ask-juno' | 'juno-knows' | undefined
  if (chosen === 'ask-juno') askJunoAbout({ _tag: 'person', userId: person.id, name: person.name })
  else if (chosen === 'juno-knows') void showWhatJunoKnows(person)
  else if (chosen !== undefined) setNotifyLevel(target, notifyChoiceOf(chosen), person.name)
}

/**
 * The header's Follow on a thread you do not follow (SPEC 5 and 7): it
 * follows at once with When it matters, set as Notify me sets it, so the
 * thread follows in Slack, joins the sidebar, and ⌘Z undoes it. Notify me
 * in ⋯ changes the level afterwards.
 */
export function followThread(thread: { readonly id: string; readonly title: string }): void {
  setNotifyLevel({ kind: 'thread', id: thread.id }, 'matters', thread.title)
}

/** Opens the why popover for a message, under where its menu opened. */
export function showWhy(topicId: string, ts: string, why: Why, at: ContextMenuAt): void {
  registry.set(whyPopoverAtom, { topicId, ts, why, at })
}

export function closeWhy(): void {
  registry.set(whyPopoverAtom, undefined)
}

/** The popover's Change: Notify me for the setting that decided it, or the Notifications page for the hours. */
export async function changeFromWhy(why: Why, at: ContextMenuAt): Promise<void> {
  closeWhy()
  if (why.action.kind === 'hours') return openSettings('notifications')
  if (why.action.kind !== 'change') return
  const { target, name } = why.action
  const settings = await loadNotificationSettings(registry)
  // A level decided it, so a thread is either stored as Every message or unfollowed (Never).
  const current = target.kind === 'thread' ? (settings?.threads[target.id] === 'every' ? 'every' : 'never') : choiceFor(settings, target)
  // The three choices themselves, not a Notify me submenu.
  const choices = personMenuItems({ name, notify: current }).flatMap((item) => (item.type === 'submenu' ? item.items : []))
  const chosen = (await popupContextMenu(nativeMenu(choices), at)) as NotifyAction | undefined
  if (chosen !== undefined) setNotifyLevel(target, notifyChoiceOf(chosen), name)
}
