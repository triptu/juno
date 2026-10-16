/**
 * Tab expiry (SPEC 6 and 14): a tab not viewed for the time Settings ›
 * General chooses ("Close tabs not viewed in": Never, 1 day, 3 days or 7
 * days) closes by itself, onto the reopen stack. The active tab and a tab
 * with an unsent draft stay. The sweep runs once the saved tabs are read and
 * then hourly, so a tab may close up to an hour late; the exact time does
 * not matter. The rule is `expireTabs` in `tabs.ts`.
 */
import { Effect, Exit } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { newChatAtom, untouched } from './newChat'
import { draftAtom } from './send'
import { currentPlace, expireTabs, TAB_EXPIRY_DEFAULT, tabExpiryMs, tabsAtom, updateTabs, type Tab, type TabExpiry } from './tabs'

export const TAB_EXPIRY_PREF = 'tabExpiry'
const SWEEP_MS = 60 * 60 * 1000

const savedTabExpiryAtom = liveQuery(prefsGet)({ key: TAB_EXPIRY_PREF })
const isExpiry = (value: unknown): value is TabExpiry => value === 'never' || value === '1d' || value === '3d' || value === '7d'

export const tabExpiryAtom = Atom.make((get): TabExpiry => {
  const saved = get(savedTabExpiryAtom)
  return AsyncResult.isSuccess(saved) && isExpiry(saved.value) ? saved.value : TAB_EXPIRY_DEFAULT
})

export function setTabExpiry(registry: Registry, expiry: TabExpiry): void {
  void runCommand(registry, prefsSet, { key: TAB_EXPIRY_PREF, value: expiry })
}

/** A live value once it has arrived, or undefined if it failed. */
async function settled<A>(registry: Registry, atom: Atom.Atom<AsyncResult.AsyncResult<A, unknown>>): Promise<A | undefined> {
  const unmount = registry.mount(atom)
  const exit = await Effect.runPromiseExit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).finally(unmount)
  return Exit.isSuccess(exit) ? exit.value : undefined
}

/** Whether a tab holds something unsent: a New chat with a draft or a destination, or a topic with a draft. A draft that cannot be read counts. */
async function holdsDraft(registry: Registry, tab: Tab): Promise<boolean> {
  const place = currentPlace(tab)
  if (place.kind === 'newChat') return !untouched(registry.get(newChatAtom(tab.id)))
  if (place.kind !== 'topic') return false
  const draft = await settled(registry, draftAtom(place.topicId))
  return draft === undefined || draft.trim() !== ''
}

/** Closes the tabs not viewed in the chosen time. */
export async function sweepTabs(registry: Registry): Promise<void> {
  const expiry = (await settled(registry, savedTabExpiryAtom)) ?? TAB_EXPIRY_DEFAULT
  const maxAge = tabExpiryMs[isExpiry(expiry) ? expiry : TAB_EXPIRY_DEFAULT]
  const now = Date.now()
  const tabs = registry.get(tabsAtom)
  const due = tabs.tabs.filter((tab) => tab.id !== tabs.active && tab.lastViewedAt !== undefined && now - tab.lastViewedAt > maxAge)
  const kept = new Set<string>()
  for (const tab of due) if (await holdsDraft(registry, tab)) kept.add(tab.id)
  updateTabs(registry, (current) => expireTabs(current, now, maxAge, (tab) => kept.has(tab.id)))
}

/** Sweeps once the saved tabs are read, then hourly. Returns the stop. */
export function startTabExpiry(registry: Registry): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  const unsubscribe = registry.subscribe(
    tabsAtom,
    (tabs) => {
      if (timer !== undefined || tabs.tabs.length === 0) return
      timer = setInterval(() => void sweepTabs(registry), SWEEP_MS)
      void sweepTabs(registry)
    },
    { immediate: true },
  )
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}
