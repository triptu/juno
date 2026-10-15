/**
 * Notification settings, the Notifications page, the avatar menu's status
 * and the why popover (spec section 14). The engine decides; these atoms
 * only read and write.
 */
import { Exit } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import {
  notificationsPage,
  notificationsSetHours,
  notificationsSetMatters,
  notificationsSetPresence,
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

/** The settings as stored, with AI assist. The menus read the Notify me levels here. */
export const notificationSettingsAtom = liveQuery(notificationsSettings)(undefined)

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

/** The settings once they have arrived: after the first value, or undefined after a second. */
export function loadNotificationSettings(registry: Registry): Promise<NotificationSettingsView | undefined> {
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
      if (result._tag === 'Success') finish(result.value)
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

/** Set yourself away or active: holds until the next switch in the active hours. */
export function setPresence(registry: Registry, presence: PresenceValue): void {
  void runCommand(registry, notificationsSetPresence, { presence })
}
