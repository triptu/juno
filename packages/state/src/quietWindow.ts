import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

const savedQuietDays = liveQuery(prefsGet)({ key: 'quietDays' })

export const quietDaysAtom = Atom.make((get) => {
  const saved = get(savedQuietDays)
  return AsyncResult.isSuccess(saved) && (saved.value === 1 || saved.value === 3 || saved.value === 7 || saved.value === 14) ? saved.value : 7
})

export function setQuietDays(registry: Registry, days: number): void {
  void runCommand(registry, prefsSet, { key: 'quietDays', value: days })
}
