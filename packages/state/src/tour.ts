/**
 * The tour (SPEC 4): a few steps that show a Slack user how Juno is laid
 * out. It opens by itself over the app once per workspace: when the
 * workspace has not seen it and the sidebar has rows, so after a first
 * sign-in it waits for the first sync's rows, and on an install from
 * before the tour it opens on the first launch. Otherwise it opens only
 * when the owner asks: Help › Show the Tour, ⌘K "Show the tour" or
 * Settings › About.
 *
 * Seen is one workspace preference, `tourSeen`, written when the tour
 * closes by any way (Skip tour, Esc, Done). Preferences live in the
 * workspace's user.db, which signing out keeps, so signing out and in
 * again does not bring the tour back.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { signedInAtom } from './session'
import { tourOpensItself } from './shell'
import { sidebarListAtom } from './sidebar'

export const TOUR_SEEN_PREF = 'tourSeen'

const savedTourSeenAtom = liveQuery(prefsGet)({ key: TOUR_SEEN_PREF })

/**
 * What the owner did in this run, for one workspace: opened the tour from a
 * menu, or closed it. Until then (`auto`) the preference decides.
 */
interface TourRequest {
  readonly teamId: string | undefined
  readonly request: 'auto' | 'open' | 'closed'
}

const tourRequestAtom = Atom.make<TourRequest>({ teamId: undefined, request: 'auto' }).pipe(Atom.keepAlive)

/** The step on screen. Starts at the first each time the tour opens. */
export const tourStepAtom = Atom.make(0).pipe(Atom.keepAlive)

/**
 * Whether the tour shows. While the preference loads it does not, so a
 * workspace that has seen it never shows it for a frame. By itself it
 * waits for the sidebar's first rows, so it never opens over a first sync
 * that has nothing to show yet, and once open it stays until it is closed.
 */
export const tourOpenAtom = Atom.make((get): boolean => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return false
  const { teamId: forTeam, request } = get(tourRequestAtom)
  if (forTeam === teamId && request !== 'auto') return request === 'open'
  if (!tourOpensItself) return false
  const saved = get(savedTourSeenAtom)
  if (!AsyncResult.isSuccess(saved) || saved.value === true) return false
  if (Option.getOrUndefined(get.self<boolean>()) === true) return true
  return get(sidebarListAtom).order.length > 0
})

/** Opens the tour at its first step, seen or not. */
export function showTour(registry: Registry): void {
  registry.set(tourStepAtom, 0)
  registry.set(tourRequestAtom, { teamId: registry.get(signedInAtom)?.teamId, request: 'open' })
}

/** Closes the tour and records it as seen for the workspace. */
export function closeTour(registry: Registry): void {
  registry.set(tourRequestAtom, { teamId: registry.get(signedInAtom)?.teamId, request: 'closed' })
  void runCommand(registry, prefsSet, { key: TOUR_SEEN_PREF, value: true })
}
