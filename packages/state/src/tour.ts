/**
 * The tour (SPEC 4): a few steps that show a Slack user how Juno is laid
 * out. It opens by itself over the app after a first sign-in made in this
 * run (after "Set up Juno" when that shows), unless the workspace has seen
 * it, and otherwise only when the owner asks for it: Help › Show the Tour,
 * ⌘K "Show the tour" or Settings › About. A relaunch, or signing in again
 * after Slack expired the session, never opens it.
 *
 * Seen is one workspace preference, `tourSeen`, written when the tour
 * closes by any way (Skip tour, Esc, Done). Preferences live in the
 * workspace's user.db, which signing out keeps, so signing out and in
 * again does not bring the tour back.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { signedInAtom } from './session'

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

/**
 * A first sign-in started in this run (the sign-in page, not "Slack signed
 * you out"): the tour may open by itself once it succeeds. Not kept across
 * a relaunch.
 */
const tourAfterSignInAtom = Atom.make(false).pipe(Atom.keepAlive)

/** The step on screen. Starts at the first each time the tour opens. */
export const tourStepAtom = Atom.make(0).pipe(Atom.keepAlive)

/**
 * Whether the tour shows. While the preference loads it does not, so a
 * workspace that has seen it never shows it for a frame.
 */
export const tourOpenAtom = Atom.make((get): boolean => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return false
  const { teamId: forTeam, request } = get(tourRequestAtom)
  if (forTeam === teamId && request !== 'auto') return request === 'open'
  if (!get(tourAfterSignInAtom)) return false
  const saved = get(savedTourSeenAtom)
  return AsyncResult.isSuccess(saved) && saved.value !== true
})

/**
 * A sign-in is starting. From the sign-in page (`firstRun`) the tour may
 * open once it succeeds, and the workspace's preference decides, not what
 * an earlier session in this run did.
 */
export function tourAfterSignIn(registry: Registry, firstRun: boolean): void {
  registry.set(tourAfterSignInAtom, firstRun)
  if (firstRun) registry.set(tourRequestAtom, { teamId: undefined, request: 'auto' })
}

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
