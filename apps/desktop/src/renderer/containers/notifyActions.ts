/**
 * Notify me (SPEC 5 and 14, inventory 15.3 and 15.6). The engine stores the choice and, on a thread, follows or
 * unfollows it; each change shows a toast with Undo. Follow new threads, beside it in a conversation's menus, works
 * the same way.
 */
import {
  channelsFollowNew,
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
import { currentNotificationSettings, holdLevel, junoAvailableAtom, loadNotificationSettings, notificationSettingsAtom, pendingLevel, popupContextMenu, registry, releaseSidebarTopic, runAction } from '@juno/state'
import { askJunoAbout, showWhatJunoKnows } from './juno/actions'
import { openNotificationsAt } from './notificationsAnchor'
import { topicOf, watchTopic } from './topicSource'

/** Sets a Notify me choice: "#design-review: Never", with Undo. */
export function setNotifyLevel(target: NotifyTargetView, choice: NotifyChoice, label: string): void {
  // Following or unfollowing a thread adds or removes its row at once, even while the sidebar holds its order (SPEC 5).
  if (target.kind === 'thread') releaseSidebarTopic(registry, target.id)
  // Menus opened before the settings and the follow flag show it read the choice just made; the toast waits for them too.
  void holdLevel(registry, target, choice, () => runAction(registry, notificationsSetLevel, { target, choice }, { text: `${label}: ${notifyChoiceLabel(choice)}` }, () => shown(target, choice)))
}

/** Longest a hold waits for the sources, for when an Undo or Slack changes the level again before they show this one. */
const SHOWN_WAIT_MS = 10_000

/**
 * Resolves once the menus' own sources show `choice` as they read it (`choiceFor`): the settings and, on a thread,
 * the follow flag of its header or row. The command has written both when this starts; their live queries trail it.
 */
function shown(target: NotifyTargetView, choice: NotifyChoice): Promise<void> {
  const subscribed = () => target.kind === 'thread' && topicOf(target.id)?.subscribed === true
  return settled(() => storedChoice(currentNotificationSettings(registry), target, subscribed()) === choice, target.kind === 'thread' ? target.id : undefined)
}

/** Resolves once `agrees` holds for the settings and, when given, the thread's row, or after `SHOWN_WAIT_MS`. */
function settled(agrees: () => boolean, thread?: string): Promise<void> {
  return new Promise((resolve) => {
    const stops: Array<() => void> = []
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      // The registry may be mid-notify: unsubscribe after.
      queueMicrotask(() => { for (const stop of stops) stop() })
      resolve()
    }
    const timer = setTimeout(finish, SHOWN_WAIT_MS)
    const check = () => { if (agrees()) finish() }
    stops.push(registry.subscribe(notificationSettingsAtom, check))
    if (thread !== undefined) stops.push(watchTopic(thread, check))
    if (agrees()) finish()
  })
}

/** Whether Follow new threads is on for a channel, DM or group DM. */
export function followsNew(settings: NotificationSettingsView | undefined, channel: string): boolean {
  return settings?.followNewThreads.includes(channel) === true
}

/** Follow new threads on or off (SPEC 5): "Following new threads in #eng", with Undo, once the menus show it. */
export function setFollowNew(channel: { readonly id: string; readonly label: string }, on: boolean): void {
  const text = on ? `Following new threads in ${channel.label}` : `Stopped following new threads in ${channel.label}`
  void runAction(registry, channelsFollowNew, { channel: channel.id, on }, { text }, () =>
    settled(() => followsNew(currentNotificationSettings(registry), channel.id) === on))
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
