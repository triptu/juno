/**
 * Peek (spec section 5): hold the peek key over a sidebar row to read the
 * topic in a popover. A peek is a read that never marks: it calls no read
 * command, opens no tab and moves no focus (`peekNeverMarks` in
 * `specs/readstate.qnt`).
 *
 * The key is one workspace preference, `peekKey`: ⌥ Option (the default,
 * which works while typing) or Space (only when no text field has focus).
 * Fn is not offered: macOS does not report it to apps reliably.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

export type PeekKey = 'option' | 'space'

export const PEEK_KEY_PREF = 'peekKey'

const DEFAULT_PEEK_KEY: PeekKey = 'option'

const savedPeekKeyAtom = liveQuery(prefsGet)({ key: PEEK_KEY_PREF })

/** The peek key of the open workspace. ⌥ Option until the preference says otherwise. */
export const peekKeyAtom = Atom.make((get): PeekKey => {
  const saved = get(savedPeekKeyAtom)
  return AsyncResult.isSuccess(saved) && saved.value === 'space' ? 'space' : DEFAULT_PEEK_KEY
})

export function setPeekKey(registry: Registry, key: PeekKey): void {
  void runCommand(registry, prefsSet, { key: PEEK_KEY_PREF, value: key })
}

/**
 * Whether a key press is the peek key. `key` is `KeyboardEvent.key`;
 * `typing` is whether a text field has focus, where Space types a space.
 */
export function isPeekKey(peekKey: PeekKey, key: string, typing: boolean): boolean {
  return peekKey === 'option' ? key === 'Alt' : key === ' ' && !typing
}
