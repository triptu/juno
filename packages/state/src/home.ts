/**
 * Home in the renderer (SPEC section 12, `docs/design/home/README.md`).
 *
 * - `homeViewAtom`: the engine's `home.view`. Home shows its live items,
 *   and while the pointer or keyboard focus is in the rows holds them
 *   (`holdHome`), so a row never moves or leaves under the pointer unless
 *   the user acted on it.
 * - `homeItemLimit`: the cap, from the window, chosen when Home appears;
 *   the greeting and the scene come from `homeScene.ts`.
 * - `prefetchHome`: warms `home.view` on pointer enter or focus of the
 *   sidebar's Home button, so an open after the subscription's idle time
 *   renders what is cached instead of waiting on the engine.
 * - `startVisitLog`: tells the engine which topic was open for a minute,
 *   for "Pick up where you left off".
 * - `markFollowUpDone`, `resolveAllTopics`: the two row buttons.
 * - `actOnSettled`: Resolve or Keep open on one row of Tidy up's review.
 * - `actOnDoneFollowUp`, `actOnOldDraft`: the two buttons of the reviews of
 *   follow-ups that look done and of old drafts.
 * - `tidyUpPrefsAtom`, `setTidyUpPrefs`: Settings › Tidy up.
 */
import { Exit } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { draftsDiscard, draftsKeep, followUpsMarkDone, followUpsNotDone, homeMarkDone, homeMovesSeen, homeMovesShown, homeView, homeVisit, viewsSortChannel, prefsGet, tidyUpSet, TIDY_UP_PREF, tidyUpPrefsOf, topicsKeepOpen, topicsResolve, type CommandResult, type HomeItem, type HomeTopic, type HomeView, type TidyUpPrefs, type UndoCommand } from '@juno/contract'
import { liveQuery, prefetch, runCommand } from './atoms'
import { errorOf } from './result'
import type { Registry } from './client'
import { activeTab, currentPlace, tabsAtom } from './tabs'
import { homeAppeared, homeGreeting, homeScene, type HomeScene } from './homeScene'
import { runActionExit, showToast, undoStackAtom, UNDO_LIMIT } from './undo'

export const homeViewAtom = liveQuery(homeView)(undefined)

/** Warms Home for an open (performance 4.2): one entry of at most three per registry (`prefetch`). A local query only. */
export function prefetchHome(registry: Registry): void {
  prefetch(registry, homeViewAtom)
}

/** At most this many rows; two on a window shorter than `SHORT_WINDOW` px, one there while the welcome card shows. */
const ITEM_LIMIT = 3
const SHORT_LIMIT = 2
const SHORT_WELCOME_LIMIT = 1
const SHORT_WINDOW = 600
/** A topic counts as visited after this long on screen (the domain's `VISIT_MIN_MILLIS`). */
export const VISIT_MILLIS = 60_000

export const homeItemLimit = (windowHeight: number, welcome = false): number => (windowHeight >= SHORT_WINDOW ? ITEM_LIMIT : welcome ? SHORT_WELCOME_LIMIT : SHORT_LIMIT)

/**
 * What a Home on screen shows of `live` (ranked, uncapped) while its rows
 * hold (SPEC 12, "Home is live"): the items of `shown` in their places,
 * each with its contents from `live`, so a title line or art still changes
 * in place. An item that left `live` stays with its last contents and a new
 * one waits, except the items the user acted on (`released`): one of those
 * that left goes at once, the rows below close up, and the next items in
 * rank take the places it freed; one that came back (Undo) takes its place
 * by rank. Returns `shown` itself when nothing changed, so React keeps the rows.
 */
export function holdHome(shown: ReadonlyArray<HomeItem>, live: ReadonlyArray<HomeItem>, released: ReadonlySet<string>, limit: number): ReadonlyArray<HomeItem> {
  const rank = new Map(live.map((item, index) => [item.id, index]))
  const items = shown.flatMap((item) => {
    const index = rank.get(item.id)
    if (index !== undefined) return [live[index]!]
    return released.has(item.id) ? [] : [item]
  })
  for (const id of released) {
    const index = rank.get(id)
    if (index === undefined || items.some((item) => item.id === id)) continue
    const at = items.findIndex((item) => (rank.get(item.id) ?? -1) > index)
    items.splice(at < 0 ? items.length : at, 0, live[index]!)
  }
  for (const item of live) {
    if (items.length >= Math.min(shown.length, limit)) break
    if (!items.some((other) => other.id === item.id)) items.push(item)
  }
  const held = items.slice(0, limit)
  return held.length === shown.length && held.every((item, i) => item === shown[i]) ? shown : held
}

/** Home's second line until Home is ready in the first sync: present tense, names what is happening (SPEC 17). */
export const HOME_SYNCING_LINE = 'Syncing with Slack.'

/** When one Home on screen appeared: its scene and greeting are of that moment, and do not change on the minute. */
export interface HomeAppearance {
  readonly at: number
  /** The first Home of the day, which may show the season's scene. */
  readonly firstVisitToday: boolean
  /** An earlier Home showed Automated's record card and the view still has it: this Home leaves it out (`markMovesShown`). */
  readonly movesShown: boolean
}

/** Home appeared (mounted): call once per Home on screen. */
export function homeAppears(registry: Registry): HomeAppearance {
  const now = new Date()
  return { at: now.getTime(), firstVisitToday: homeAppeared(registry, now), movesShown: registry.get(movesShownPendingAtom) }
}

/** What Home says over its rows, from the live view: the scene, the greeting and, until Home is ready, the syncing line. */
export function homeHeading(view: HomeView, items: ReadonlyArray<HomeItem>, appearance: HomeAppearance): { readonly scene: HomeScene; readonly title: string; readonly line: string | undefined; readonly caughtUp: boolean } {
  const now = new Date(appearance.at)
  // Ready with no rows is caught up (SPEC 12); before that it never says "All caught up".
  const done = view.ready && items.length === 0
  return {
    scene: homeScene({ now, caughtUp: done, firstVisitToday: appearance.firstVisitToday }),
    title: homeGreeting({ now, firstName: view.firstName, caughtUp: done }).title,
    line: view.ready ? undefined : HOME_SYNCING_LINE,
    caughtUp: done,
  }
}

/** How long a visit the engine did not get waits before it is sent again. */
const VISIT_RETRY_MILLIS = 1_000

/**
 * Follows the active tab and records a topic once it has been on screen
 * for `VISIT_MILLIS`, and again when it leaves, so the engine knows the
 * last topic the user had open. A visit made while the engine connection is
 * down (a reconnect, a restart) is sent again each second until it lands;
 * visits go one at a time, in order, so one held back never lands after a
 * later one. Returns the stop function.
 */
export function startVisitLog(registry: Registry): () => void {
  let current: { readonly id: string; timer: ReturnType<typeof setTimeout> | undefined; counted: boolean } | undefined
  let stopped = false
  let sending: Promise<void> = Promise.resolve()
  const send = async (id: string) => {
    for (;;) {
      const exit = await runCommand(registry, homeVisit, { id })
      if (stopped || errorOf(exit)?._tag !== 'RpcClientError') return
      await new Promise((resume) => setTimeout(resume, VISIT_RETRY_MILLIS))
    }
  }
  const visit = (id: string) => {
    sending = sending.then(() => send(id))
  }
  const leave = () => {
    if (current === undefined) return
    if (current.timer !== undefined) clearTimeout(current.timer)
    if (current.counted) visit(current.id)
    current = undefined
  }
  const follow = () => {
    const tab = activeTab(registry.get(tabsAtom))
    const place = tab === undefined ? undefined : currentPlace(tab)
    const id = place?.kind === 'topic' ? place.topicId : undefined
    if (id === current?.id) return
    leave()
    if (id === undefined) return
    const entry: NonNullable<typeof current> = { id, timer: undefined, counted: false }
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      entry.counted = true
      visit(id)
    }, VISIT_MILLIS)
    current = entry
  }
  const unsubscribe = registry.subscribe(tabsAtom, follow, { immediate: true })
  return () => {
    unsubscribe()
    leave()
    stopped = true
  }
}

/** A Home showed Automated's record card, and `home.view` has not yet come without it. */
export const movesShownPendingAtom = Atom.make(false).pipe(Atom.keepAlive)

/**
 * Home showed Automated's record card: it waits a day before it shows again (SPEC 12). Its moves stay.
 * Views the engine read before it stored that still have the card, and can reach the renderer after it,
 * so until a view comes without the card a Home opened later leaves it out (`HomeAppearance.movesShown`).
 */
export function markMovesShown(registry: Registry): void {
  registry.set(movesShownPendingAtom, true)
  let release: (() => void) | undefined
  const check = () => {
    const result = registry.get(homeViewAtom)
    if (result._tag !== 'Success' || result.value.items.some((item) => item.kind === 'automatedMoves')) return
    registry.set(movesShownPendingAtom, false)
    queueMicrotask(() => release?.())
  }
  release = registry.subscribe(homeViewAtom, check)
  void runCommand(registry, homeMovesShown, {})
}

/** The user opened Automated's record or dismissed its card: its moves are not listed again (SPEC 12). */
export function markMovesSeen(registry: Registry, item: HomeItem): void {
  const channels = item.topics.flatMap((topic) => (topic.moved === undefined ? [] : [topic.moved.channel.id]))
  void runCommand(registry, homeMovesSeen, { channels })
}

/**
 * A row of Automated's record: `act` reverses Juno's move (Move back, or
 * Move to Automated for a move back out), `keep` makes Juno's move the
 * user's own. Either has the usual toast with Undo, and resolves with the
 * undo, which gives the channel back to the rules or Juno.
 */
export async function actOnMove(registry: Registry, topic: HomeTopic, action: 'act' | 'keep', toast: string): Promise<UndoCommand | undefined> {
  const moved = topic.moved
  if (moved === undefined) return undefined
  const into = (moved.change === 'in') === (action === 'keep')
  const exit = await runActionExit(registry, viewsSortChannel, { channel: moved.channel.id, to: into ? 'automated' : 'kept' }, { text: toast })
  return Exit.isSuccess(exit) ? (exit.value as CommandResult).undo : undefined
}

/** Mark done on a Follow-up. No undo (inventory 11). */
export async function markFollowUpDone(registry: Registry, item: HomeItem): Promise<boolean> {
  const topic = item.topics[0]
  if (topic === undefined || item.messageTs === undefined) return false
  const exit = await runCommand(registry, homeMarkDone, { topicId: topic.id, messageTs: item.messageTs })
  if (Exit.isFailure(exit)) return false
  showToast(registry, { text: 'Follow-up done' })
  return true
}

/**
 * Resolve all on Tidy up: resolves each topic, and keeps one undo that puts
 * them all back, from the undos the engine computed. Toast "Resolved 3
 * topics" with Undo. Resolves with each topic's own undo, so a row of the
 * review can put back just its topic.
 */
export async function resolveAllTopics(registry: Registry, ids: ReadonlyArray<string>): Promise<ReadonlyArray<Extract<UndoCommand, { _tag: 'topics.restore' }>>> {
  const exits = await Promise.all(ids.map((id) => runCommand(registry, topicsResolve, { id })))
  const restores = exits.flatMap((exit) => {
    if (Exit.isFailure(exit)) return []
    const undo = (exit.value as CommandResult).undo
    return undo?._tag === 'topics.restore' ? [undo] : []
  })
  if (restores.length === 0) return restores
  const undo: UndoCommand = { _tag: 'topics.restoreAll', restores: restores.map((restore) => ({ id: restore.id, overlay: restore.overlay, ...(restore.unreadFrom === undefined ? {} : { unreadFrom: restore.unreadFrom }) })) }
  registry.set(undoStackAtom, [...registry.get(undoStackAtom), undo].slice(-UNDO_LIMIT))
  showToast(registry, { text: restores.length === 1 ? 'Resolved 1 topic' : `Resolved ${restores.length} topics`, check: true }, true)
  return restores
}

/**
 * One row of Tidy up's review: Resolve or Keep open, with the usual toast
 * and Undo. Resolves with the undo, so the row's own Undo can replay it
 * (`undoOne`), or undefined when nothing changed.
 */
export async function actOnSettled(registry: Registry, topic: HomeTopic, action: 'resolve' | 'keep'): Promise<UndoCommand | undefined> {
  const exit =
    action === 'resolve'
      ? await runActionExit(registry, topicsResolve, { id: topic.id }, { text: `Resolved · ${topic.title}`, check: true })
      : await runActionExit(registry, topicsKeepOpen, { id: topic.id }, { text: `Keeping open · ${topic.title}` })
  return Exit.isSuccess(exit) ? (exit.value as CommandResult).undo : undefined
}

/**
 * One row of the review of follow-ups that look done: Mark done, or Not
 * done (the promise stays, and this match is not proposed again), each
 * with a toast and Undo. Resolves with the undo, or undefined when nothing
 * changed.
 */
export async function actOnDoneFollowUp(registry: Registry, topic: HomeTopic, action: 'done' | 'notDone'): Promise<UndoCommand | undefined> {
  const match = topic.followUp
  if (match === undefined) return undefined
  const key = { topicId: topic.id, messageTs: match.promiseTs }
  const exit =
    action === 'done'
      ? await runActionExit(registry, followUpsMarkDone, key, { text: 'Follow-up done', check: true })
      : await runActionExit(registry, followUpsNotDone, { ...key, matchTs: match.ts }, { text: 'Kept in Follow-up' })
  return Exit.isSuccess(exit) ? (exit.value as CommandResult).undo : undefined
}

/** One row of the review of old drafts: Delete or Keep, each with a toast and Undo. */
export async function actOnOldDraft(registry: Registry, topic: HomeTopic, action: 'delete' | 'keep'): Promise<UndoCommand | undefined> {
  const draft = topic.draft
  if (draft === undefined) return undefined
  const shown = { topicId: topic.id, updatedAt: String(draft.at) }
  const exit =
    action === 'delete'
      ? await runActionExit(registry, draftsDiscard, shown, { text: `Draft deleted · ${topic.title}` })
      : await runActionExit(registry, draftsKeep, shown, { text: `Keeping draft · ${topic.title}` })
  return Exit.isSuccess(exit) ? (exit.value as CommandResult).undo : undefined
}

const savedTidyUpAtom = liveQuery(prefsGet)({ key: TIDY_UP_PREF })

/** Settings › Tidy up, with the defaults for what was never saved. */
export const tidyUpPrefsAtom = Atom.make((get): TidyUpPrefs => {
  const saved = get(savedTidyUpAtom)
  return tidyUpPrefsOf(AsyncResult.isSuccess(saved) ? saved.value : undefined)
})

export function setTidyUpPrefs(registry: Registry, patch: Partial<TidyUpPrefs>): void {
  void runCommand(registry, tidyUpSet, { patch })
}
