/**
 * The welcome card (SPEC 4, "The welcome"): three things to try, on Home,
 * each ticked off when the owner does it. It shows by itself once per
 * workspace: when the workspace has not seen it and the sidebar has rows,
 * so after a first sign-in it waits for the first sync's rows, and on an
 * install from before it, it shows on the first launch. Help › Show the
 * Tour, ⌘K "Show the tour" and Settings › About bring it back.
 *
 * Two workspace preferences hold it, so it survives a relaunch: `tourSeen`,
 * written when the card is hidden or done, and `welcomeTicks`, the hints
 * done so far. Preferences live in the workspace's user.db, which signing
 * out keeps, so signing out and in again does not bring the card back.
 * A card whose three hints were all done in an earlier run counts as seen.
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
export const WELCOME_TICKS_PREF = 'welcomeTicks'

/** The three things to try, in the card's order. */
export const welcomeHints = ['peek', 'tab', 'juno'] as const
export type WelcomeHint = (typeof welcomeHints)[number]

export interface Welcome {
  /** The hints done, in the card's order. */
  readonly done: ReadonlyArray<WelcomeHint>
  /** False until the sidebar has rows: Home keeps the card's room, empty, so nothing moves when it fills. */
  readonly ready: boolean
}

const savedSeenAtom = liveQuery(prefsGet)({ key: TOUR_SEEN_PREF })
const savedTicksAtom = liveQuery(prefsGet)({ key: WELCOME_TICKS_PREF })

/**
 * What the owner did in this run, for one workspace: asked for the card
 * again, or hid it. Until then (`auto`) the preferences decide. `ticks`
 * are the hints done in this run, shown at once, before the preference
 * comes back; `finished` is set when the last of them was done in this run,
 * so "You're all set" stays until Done or the next launch.
 */
interface WelcomeRun {
  readonly teamId: string | undefined
  readonly request: 'auto' | 'open' | 'closed'
  readonly ticks: ReadonlyArray<WelcomeHint>
  readonly finished: boolean
}

const fresh = (teamId: string | undefined, request: WelcomeRun['request']): WelcomeRun => ({ teamId, request, ticks: [], finished: false })

const welcomeRunAtom = Atom.make<WelcomeRun>(fresh(undefined, 'auto')).pipe(Atom.keepAlive)

/** Whether the sidebar has rows: a boolean, so the card does not recompute as the list changes. */
const sidebarHasRowsAtom = Atom.make((get): boolean => get(sidebarListAtom).order.length > 0)

const isHint = (value: unknown): value is WelcomeHint => typeof value === 'string' && (welcomeHints as ReadonlyArray<string>).includes(value)

/** The card's hints in its order: those saved and those done in this run. */
const doneOf = (saved: unknown, run: ReadonlyArray<WelcomeHint>): ReadonlyArray<WelcomeHint> => {
  const stored = Array.isArray(saved) ? saved.filter(isHint) : []
  return welcomeHints.filter((hint) => stored.includes(hint) || run.includes(hint))
}

/**
 * The card, or undefined when it does not show. While the preferences load
 * it does not show, so a workspace that has seen it never shows it for a
 * frame. Once it shows it stays until it is hidden or done.
 */
export const welcomeAtom = Atom.make((get): Welcome | undefined => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return undefined
  const run = get(welcomeRunAtom)
  const own = run.teamId === teamId ? run : fresh(teamId, 'auto')
  if (own.request === 'closed') return undefined
  const ticks = get(savedTicksAtom)
  if (!AsyncResult.isSuccess(ticks)) return undefined
  const done = doneOf(own.request === 'open' ? [] : ticks.value, own.ticks)
  if (own.request === 'open') return { done, ready: get(sidebarHasRowsAtom) }
  if (!tourOpensItself) return undefined
  const seen = get(savedSeenAtom)
  if (!AsyncResult.isSuccess(seen) || seen.value === true) return undefined
  // Done in an earlier run: seen. Done in this one: "You're all set" until Done.
  if (done.length === welcomeHints.length && !own.finished) return undefined
  if (Option.getOrUndefined(get.self<Welcome | undefined>()) !== undefined) return { done, ready: true }
  return { done, ready: get(sidebarHasRowsAtom) }
})

const runOf = (registry: Registry): WelcomeRun => {
  const teamId = registry.get(signedInAtom)?.teamId
  const run = registry.get(welcomeRunAtom)
  return run.teamId === teamId ? run : fresh(teamId, 'auto')
}

/** Brings the card back on Home with nothing ticked, seen or not, until it is hidden or done. */
export function showWelcome(registry: Registry): void {
  registry.set(welcomeRunAtom, fresh(registry.get(signedInAtom)?.teamId, 'open'))
  void runCommand(registry, prefsSet, { key: WELCOME_TICKS_PREF, value: [] })
  void runCommand(registry, prefsSet, { key: TOUR_SEEN_PREF, value: false })
}

/** Hide, or Done: the card goes and the workspace has seen it. */
export function closeWelcome(registry: Registry): void {
  registry.set(welcomeRunAtom, { ...runOf(registry), request: 'closed' })
  void runCommand(registry, prefsSet, { key: TOUR_SEEN_PREF, value: true })
}

/** The owner did one of the three things. Recorded only while the card shows, and once. */
export function tickWelcome(registry: Registry, hint: WelcomeHint): void {
  const welcome = registry.get(welcomeAtom)
  if (welcome === undefined || !welcome.ready || welcome.done.includes(hint)) return
  const run = runOf(registry)
  const done = welcomeHints.filter((each) => welcome.done.includes(each) || each === hint)
  registry.set(welcomeRunAtom, { ...run, ticks: [...run.ticks, hint], finished: run.finished || done.length === welcomeHints.length })
  void runCommand(registry, prefsSet, { key: WELCOME_TICKS_PREF, value: done })
}
