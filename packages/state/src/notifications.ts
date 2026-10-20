/**
 * Notification settings, the Notifications page, the avatar menu's status
 * and the why popover (spec section 14). The engine decides; these atoms
 * only read and write.
 */
import { Exit } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import {
  notificationsPage,
  notificationsRestoreSlackSchedule,
  notificationsSetHours,
  notificationsSetHuddleRing,
  notificationsSetMatters,
  notificationsSetPresence,
  notificationsSetSlackSchedule,
  notificationsSettings,
  notificationsStatus,
  notificationsWhy,
  type Hours,
  type NotificationSettingsView,
  type PresenceValue,
  type Why,
} from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { showToast } from './undo'

/** The settings as stored, with AI assist. The menus read the Notify me levels here. */
export const notificationSettingsAtom = liveQuery(notificationsSettings)(undefined)

/** The global AI assist switch (SPEC section 15). On until the settings say otherwise. */
export const aiAssistOnAtom = Atom.make((get): boolean => {
  const settings = get(notificationSettingsAtom)
  return !(AsyncResult.isSuccess(settings) && settings.value.aiAssist === false)
})

/** The Notifications page beyond the settings: the two lists and today. */
export const notificationsPageAtom = liveQuery(notificationsPage)(undefined)

/** Presence and "Paused until 9am", for the avatar menu. */
export const notificationStatusAtom = liveQuery(notificationsStatus)(undefined)

/** The why popover open on a message, or nothing. */
export interface WhyPopover {
  readonly topicId: string
  readonly ts: string
  readonly why: Why
  /** Where the message menu opened, in window pixels. */
  readonly at: { readonly x: number; readonly y: number }
}

export const whyPopoverAtom = Atom.make<WhyPopover | undefined>(undefined).pipe(Atom.keepAlive)

/** The settings when the atom holds them, without waiting. The menus use them so they open in the same frame. */
export function currentNotificationSettings(registry: Registry): NotificationSettingsView | undefined {
  const result = registry.get(notificationSettingsAtom)
  return result._tag === 'Success' ? result.value : undefined
}

/**
 * The settings once they have arrived: the first value `accept` takes (by
 * default the first value), or undefined after a second.
 */
export function loadNotificationSettings(
  registry: Registry,
  accept: (settings: NotificationSettingsView) => boolean = () => true,
): Promise<NotificationSettingsView | undefined> {
  return new Promise((resolve) => {
    let done = false
    let release: (() => void) | undefined
    const finish = (value: NotificationSettingsView | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      queueMicrotask(() => release?.())
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), 1_000)
    const check = () => {
      const result = registry.get(notificationSettingsAtom)
      if (result._tag === 'Success' && accept(result.value)) finish(result.value)
    }
    release = registry.subscribe(notificationSettingsAtom, check, { immediate: true })
  })
}

/** Why a message did or did not notify. Undefined when the engine could not say. */
export async function loadWhy(registry: Registry, topicId: string, ts: string): Promise<Why | undefined> {
  const exit = await runCommand(registry, notificationsWhy, { topicId, ts })
  return Exit.isSuccess(exit) ? exit.value : undefined
}

export function setHours(registry: Registry, which: 'notifications' | 'presence', hours: Hours): void {
  void runCommand(registry, notificationsSetHours, { which, hours })
}

export function setMatters(registry: Registry, text: string): void {
  void runCommand(registry, notificationsSetMatters, { text })
}

/** Ring for huddles (SPEC 20, "Incoming huddles"). */
export function setHuddleRing(registry: Registry, enabled: boolean): void {
  void runCommand(registry, notificationsSetHuddleRing, { enabled })
}

/** Set yourself away or active: holds until the next switch in the active hours. */
export function setPresence(registry: Registry, presence: PresenceValue): void {
  void runCommand(registry, notificationsSetPresence, { presence })
}

/** Use the notification hours in Slack's own schedule, or stop. On applies them once at once. */
export function setSlackSchedule(registry: Registry, enabled: boolean): void {
  void runCommand(registry, notificationsSetSlackSchedule, { enabled })
}

/** Puts back the schedule Slack had before Juno first wrote it, and stops using the hours there. */
export async function restoreSlackSchedule(registry: Registry): Promise<void> {
  const exit = await runCommand(registry, notificationsRestoreSlackSchedule, {})
  showToast(registry, { text: Exit.isSuccess(exit) ? "Restored Slack's schedule" : "Couldn't restore Slack's schedule. Try again." })
}
