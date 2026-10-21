/**
 * Other people's presence (SPEC 7, "Presence in a DM"; SPEC 14, "Show who
 * is active in the sidebar"; contract `routes/presence.ts`) and the
 * sidebar setting. The engine sends who is active and who is away among
 * the people it follows. A DM's header reads `personPresenceAtom` and a
 * sidebar row `sidebarPersonActiveAtom` for its partner, so each
 * re-renders only when that one person changes.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet, presencePeople, SHOW_PRESENCE_PREF } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

type PersonPresence = 'active' | 'away'

const peopleAtom = liveQuery(presencePeople)(undefined)

const nobody: ReadonlyMap<string, PersonPresence> = new Map()

/** Each followed person Slack has spoken about, once the engine has said. */
const presenceMapAtom = Atom.make((get): ReadonlyMap<string, PersonPresence> => {
  const result = get(peopleAtom)
  if (!AsyncResult.isSuccess(result)) return nobody
  const map = new Map<string, PersonPresence>()
  for (const id of result.value.active) map.set(id, 'active')
  for (const id of result.value.away) map.set(id, 'away')
  return map
})

/** Whether Slack shows this person active or away. Undefined while unknown, and for an empty id. */
export const personPresenceAtom = Atom.family((userId: string) => Atom.make((get): PersonPresence | undefined => (userId === '' ? undefined : get(presenceMapAtom).get(userId))))

const savedShowPresence = liveQuery(prefsGet)({ key: SHOW_PRESENCE_PREF })

/** Show who is active in the sidebar: off unless turned on, undefined until the engine has said. */
export const showPresenceAtom = Atom.make((get): boolean | undefined => {
  const saved = get(savedShowPresence)
  return AsyncResult.isSuccess(saved) ? saved.value === true : undefined
})

/** Whether a sidebar row shows this person's dot: the setting is on and Slack shows them active. */
export const sidebarPersonActiveAtom = Atom.family((userId: string) => Atom.make((get) => get(showPresenceAtom) === true && get(personPresenceAtom(userId)) === 'active'))

export function setShowPresence(registry: Registry, enabled: boolean): void {
  void runCommand(registry, prefsSet, { key: SHOW_PRESENCE_PREF, value: enabled })
}
