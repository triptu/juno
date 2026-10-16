import { aiAvailable, prefsGet, prefsSet, sendCheckPrefKeys, type SendCheckPref } from '@juno/contract'
import * as Atom from 'effect/reactivity/Atom'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

const pref = liveQuery(prefsGet)
const checks = sendCheckPrefKeys.map((key) => ({ key, atom: pref({ key: `sendCheck.${key}` }) }))
export const sendCheckPrefsAtom = Atom.make((get) => checks.map(({ key, atom }) => {
  const value = get(atom)
  return { key, enabled: value._tag !== 'Success' || value.value !== false }
}))
export const aiAvailableAtom = liveQuery(aiAvailable)({})
export const setSendCheckPref = (registry: Registry, key: SendCheckPref, enabled: boolean) => runCommand(registry, prefsSet, { key: `sendCheck.${key}`, value: enabled })
