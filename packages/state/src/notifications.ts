/**
 * Notification settings, the Notifications page, today's decisions and the
 * avatar menu's status (spec section 14). The engine decides; these atoms
 * only read and write.
 */
import { Exit } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import {
  notificationsCheckInstruction,
  notificationsDecisions,
  notificationsPage,
  notificationsRemoveInstruction,
  notificationsSaveInstruction,
  notificationsSetAlwaysNotify,
  notificationsSetHours,
  notificationsSetHuddleRing,
  notificationsSetDay,
  notificationsSetPresence,
  notificationsSettings,
  notificationsStatus,
  notificationsUseJunoHours,
  type AlwaysNotifySwitch,
  type Hours,
  type InstructionDirection,
  type InstructionRule,
  type NotificationSettingsView,
  type PresenceValue,
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

/** The Notifications page beyond the settings: the Always and Never lists, today's counts and Slack's schedule. */
export const notificationsPageAtom = liveQuery(notificationsPage)(undefined)

const decisionsAtom = liveQuery(notificationsDecisions)(undefined)
/** What Details reads while it is closed: nothing, and no subscription. */
const closed = Atom.make(AsyncResult.initial<never, never>())

/** Today's decisions, newest first, for Today › Details, while it is open. */
export const notificationDecisionsAtom = (open: boolean) => (open ? decisionsAtom : closed)

/** Presence and "Paused until 9am", for the avatar menu. */
export const notificationStatusAtom = liveQuery(notificationsStatus)(undefined)

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

export function setHours(registry: Registry, which: 'notifications' | 'presence', hours: Partial<Hours>): void {
  void runCommand(registry, notificationsSetHours, { which, hours })
}

export function setHoursDay(registry: Registry, which: 'notifications' | 'presence', day: Hours['days'][number], enabled: boolean): void {
  void runCommand(registry, notificationsSetDay, { which, day, enabled })
}

/** One Always notify switch. */
export function setAlwaysNotify(registry: Registry, which: AlwaysNotifySwitch, enabled: boolean): void {
  void runCommand(registry, notificationsSetAlwaysNotify, { which, enabled })
}

/** Adds an instruction (no id) or changes one. Resolves with its id, or undefined when it failed. */
export async function saveInstruction(registry: Registry, instruction: { readonly id?: string; readonly direction: InstructionDirection; readonly text: string }): Promise<string | undefined> {
  const exit = await runCommand(registry, notificationsSaveInstruction, instruction)
  if (Exit.isSuccess(exit)) return exit.value.id
  showToast(registry, { text: "Couldn't save the instruction. Try again." })
  return undefined
}

export function removeInstruction(registry: Registry, id: string): void {
  void runCommand(registry, notificationsRemoveInstruction, { id })
}

/** Whether an added instruction is really a rule about one person or channel. Undefined when it is not, or when Juno could not tell. */
export async function checkInstruction(registry: Registry, text: string): Promise<InstructionRule | undefined> {
  const exit = await runCommand(registry, notificationsCheckInstruction, { text })
  return Exit.isSuccess(exit) && exit.value !== null ? exit.value : undefined
}

/** Ring for huddles (SPEC 20, "Incoming huddles"). */
export function setHuddleRing(registry: Registry, enabled: boolean): void {
  void runCommand(registry, notificationsSetHuddleRing, { enabled })
}

/** Set yourself away or active: holds until the next switch in the active hours. */
export function setPresence(registry: Registry, presence: PresenceValue): void {
  void runCommand(registry, notificationsSetPresence, { presence })
}

/** Use Juno's hours: writes the notification hours to Slack's schedule again after it was changed in Slack. */
export function applyJunoHours(registry: Registry): void {
  void runCommand(registry, notificationsUseJunoHours, {})
}
