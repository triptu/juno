/**
 * What a new tab opens (spec section 6): a New chat, the default, or Home.
 * It covers the strip's "+", ⌘T and the tab that replaces the last one
 * closed. ⌘N and the sidebar's New chat button always open a New chat.
 *
 * One workspace preference, `newTabPage`, set in Settings › General.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

export type NewTabPage = 'newChat' | 'home'

export const NEW_TAB_PAGE_PREF = 'newTabPage'

const savedNewTabPageAtom = liveQuery(prefsGet)({ key: NEW_TAB_PAGE_PREF })

/** What a new tab opens in the open workspace. New chat until the preference says Home. */
export const newTabPageAtom = Atom.make((get): NewTabPage => {
  const saved = get(savedNewTabPageAtom)
  return AsyncResult.isSuccess(saved) && saved.value === 'home' ? 'home' : 'newChat'
})

export function setNewTabPage(registry: Registry, page: NewTabPage): void {
  void runCommand(registry, prefsSet, { key: NEW_TAB_PAGE_PREF, value: page })
}
