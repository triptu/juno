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
  notificationsSetHuddleRing,
  notificationsSetGroupHours,
  notificationsSetPresence,
  notificationsSettings,
  notificationsStatus,
  notificationsUseJunoHours,
  type AlwaysNotifySwitch,
  type HoursGroup,
  type InstructionDirection,
  type InstructionRule,
  type NotificationSettingsView,
  type NotifyChoice,
  type NotifyTargetView,
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

const pendingLevelsAtom = Atom.make<ReadonlyMap<string, NotifyChoice>>(new Map()).pipe(Atom.keepAlive)

const levelKey = (target: NotifyTargetView): string => `${target.kind}:${target.id}`

/**
 * A Notify me choice just made, until the menus' own sources hold it. The settings and a thread's follow flag are
 * separate live queries that arrive a moment after the command, so a menu opened in that moment reads this first.
 */
export function pendingLevel(registry: Registry, target: NotifyTargetView): NotifyChoice | undefined {
  return registry.get(pendingLevelsAtom).get(levelKey(target))
}

/** Holds `choice` for `target` until `run` is done, which waits for the sources to show it; a newer choice for the target keeps its own hold. */
export async function holdLevel(registry: Registry, target: NotifyTargetView, choice: NotifyChoice, run: () => Promise<unknown>): Promise<void> {
  const key = levelKey(target)
  const set = (next: NotifyChoice | undefined) => {
    const levels = new Map(registry.get(pendingLevelsAtom))
    if (next === undefined) levels.delete(key)
    else levels.set(key, next)
    registry.set(pendingLevelsAtom, levels)
  }
  set(choice)
  try {
    await run()
  } finally {
    if (pendingLevel(registry, target) === choice) set(undefined)
  }
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

/** One row of the notification or active hours: weekdays, Saturday or Sunday. */
export function setGroupHours(registry: Registry, which: 'notifications' | 'presence', group: HoursGroup, hours: { readonly from?: number; readonly to?: number } | 'off'): void {
  void runCommand(registry, notificationsSetGroupHours, { which, group, hours })
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
export async function checkInstruction(registry: Registry, text: string, direction: InstructionDirection): Promise<InstructionRule | undefined> {
  const exit = await runCommand(registry, notificationsCheckInstruction, { text, direction })
  return Exit.isSuccess(exit) && exit.value !== null ? exit.value : undefined
}

/** Ring for huddles (SPEC 20, "Incoming huddles"). */
export function setHuddleRing(registry: Registry, enabled: boolean): void {
  void runCommand(registry, notificationsSetHuddleRing, { enabled })
}

/** Set yourself away or active: shows at once and holds until the next switch in the active hours. */
export async function setPresence(registry: Registry, presence: PresenceValue): Promise<void> {
  const exit = await runCommand(registry, notificationsSetPresence, { presence })
  if (Exit.isSuccess(exit) && exit.value.sent) return
  showToast(registry, { text: presence === 'away' ? "Couldn't set you away. Try again." : "Couldn't set you active. Try again." })
}

/** Use Juno's hours: writes the notification hours to Slack's schedule again after it was changed in Slack. */
export function applyJunoHours(registry: Registry): void {
  void runCommand(registry, notificationsUseJunoHours, {})
}
