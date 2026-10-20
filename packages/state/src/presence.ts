/**
 * Other people's presence (SPEC 14, "Show when people are active"; contract
 * `routes/presence.ts`) and its setting. The engine sends the active user
 * ids; a sidebar row reads `personActiveAtom` for its DM partner, so it
 * re-renders only when that one person changes.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet, presenceActive, SHOW_PRESENCE_PREF } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

const activeIdsAtom = liveQuery(presenceActive)(undefined)

const nobody: ReadonlySet<string> = new Set()

/** The active user ids as a set, once the engine has said. */
const activeSetAtom = Atom.make((get): ReadonlySet<string> => {
  const result = get(activeIdsAtom)
  return AsyncResult.isSuccess(result) ? new Set(result.value) : nobody
})

/** Whether Slack shows this person active. False while unknown, and for an empty id. */
export const personActiveAtom = Atom.family((userId: string) => Atom.make((get) => userId !== '' && get(activeSetAtom).has(userId)))

const savedShowPresence = liveQuery(prefsGet)({ key: SHOW_PRESENCE_PREF })

/** Show when people are active: on unless turned off, undefined until the engine has said. */
export const showPresenceAtom = Atom.make((get): boolean | undefined => {
  const saved = get(savedShowPresence)
  return AsyncResult.isSuccess(saved) ? saved.value !== false : undefined
})

export function setShowPresence(registry: Registry, enabled: boolean): void {
  void runCommand(registry, prefsSet, { key: SHOW_PRESENCE_PREF, value: enabled })
}
