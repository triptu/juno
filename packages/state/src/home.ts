/**
 * Home in the renderer (SPEC section 12, `docs/design/home/README.md`).
 *
 * - `homeViewAtom`: the engine's `home.view`. Home keeps the items it
 *   showed when it appeared (`freezeHome`) and takes only their `aiTitle`
 *   from later values, so a row never moves or leaves under the pointer.
 *   During the first sync it adds items as they land, below the ones it
 *   shows, into slots it reserved (`fillHome`).
 * - `homeGreeting`, `homeScene`, `homeItemLimit`: the copy, the scene and
 *   the cap, from the local clock and the window, chosen when Home appears.
 * - `prefetchHome`: warms `home.view` on pointer enter or focus of the
 *   sidebar's Home button, so an open after the subscription's idle time
 *   renders what is cached instead of waiting on the engine.
 * - `startVisitLog`: tells the engine which topic was open for a minute,
 *   for "Pick up where you left off".
 * - `markFollowUpDone`, `resolveAllTopics`: the two row buttons.
 * - `actOnSettled`: Resolve or Keep open on one row of Tidy up's review.
 * - `tidyUpPrefsAtom`, `setTidyUpPrefs`: Settings › Tidy up.
 */
import { Exit } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { homeMarkDone, homeMovesSeen, homeMovesShown, homeView, homeVisit, viewsSortChannel, prefsGet, prefsSet, TIDY_UP_PREF, tidyUpPrefsOf, topicsKeepOpen, topicsResolve, type CommandResult, type HomeItem, type HomeTopic, type HomeView, type TidyUpPrefs, type UndoCommand } from '@juno/contract'
import { liveQuery, prefetch, runCommand } from './atoms'
import type { Registry } from './client'
import { activeTab, currentPlace, tabsAtom } from './tabs'
import { runActionExit, showToast, undoStackAtom, UNDO_LIMIT } from './undo'

export const homeViewAtom = liveQuery(homeView)(undefined)

/** Warms Home for an open (performance 4.2): one entry of at most three per registry (`prefetch`). A local query only. */
export function prefetchHome(registry: Registry): void {
  prefetch(registry, homeViewAtom)
}

/** The scenes in `docs/design/home/scenes.png`. */
export type HomeScene = 'morning' | 'midday' | 'evening' | 'night' | 'friday' | 'winter' | 'autumn' | 'caughtUp'

/** At most this many rows; two on a window shorter than `SHORT_WINDOW` px, one there while the welcome card shows. */
const ITEM_LIMIT = 3
const SHORT_LIMIT = 2
const SHORT_WELCOME_LIMIT = 1
const SHORT_WINDOW = 600
/** A topic counts as visited after this long on screen (the domain's `VISIT_MIN_MILLIS`). */
export const VISIT_MILLIS = 60_000

export const homeItemLimit = (windowHeight: number, welcome = false): number => (windowHeight >= SHORT_WINDOW ? ITEM_LIMIT : welcome ? SHORT_WELCOME_LIMIT : SHORT_LIMIT)

/** No items and no unread messages in followed topics. */
export const caughtUp = (view: HomeView): boolean => view.items.length === 0 && !view.unread

type TimeOfDay = 'morning' | 'midday' | 'evening' | 'night'

function timeOfDay(now: Date): TimeOfDay {
  const hour = now.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'midday'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

const isFriday = (now: Date): boolean => now.getDay() === 5 && timeOfDay(now) !== 'night'

/**
 * The greeting (the home README, "Copy"): one line, by the time of day, or
 * "All caught up." There is no count under it; the rows are the count.
 */
export function homeGreeting(input: { readonly now: Date; readonly firstName?: string | undefined; readonly caughtUp: boolean }): { readonly title: string } {
  if (input.caughtUp) return { title: 'All caught up.' }
  const name = input.firstName === undefined || input.firstName === '' ? '' : `, ${input.firstName}`
  const opening = isFriday(input.now) ? 'Happy Friday' : { morning: 'Morning', midday: 'Hello', evening: 'Evening', night: 'Still up' }[timeOfDay(input.now)]
  return { title: `${opening}${name}.` }
}

const dayKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

function seasonOf(date: Date): 'winter' | 'autumn' | undefined {
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (month === 12 || month === 1) return 'winter'
  if ((month === 9 && day >= 15) || month === 10 || (month === 11 && day <= 15)) return 'autumn'
  return undefined
}

/** One day in six inside a season window, by a hash of the date. */
function pickedDay(date: Date): boolean {
  let hash = 0
  for (const char of dayKey(date)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return seasonOf(date) !== undefined && hash % 6 === 0
}

/** A picked day whose day before was not picked: never two seasonal days running. */
function seasonalDay(date: Date): boolean {
  const yesterday = new Date(date)
  yesterday.setDate(date.getDate() - 1)
  return pickedDay(date) && !pickedDay(yesterday)
}

/**
 * The scene (the home README, "Picking a scene"): caught up, then the
 * season on the first visit of a picked day (never at night), then Friday,
 * then the time of day.
 */
export function homeScene(input: { readonly now: Date; readonly caughtUp: boolean; readonly firstVisitToday: boolean }): HomeScene {
  if (input.caughtUp) return 'caughtUp'
  const time = timeOfDay(input.now)
  const season = seasonOf(input.now)
  if (season !== undefined && input.firstVisitToday && time !== 'night' && seasonalDay(input.now)) return season
  if (isFriday(input.now)) return 'friday'
  return time
}

/** The day Home last appeared, for the seasonal scene's "first visit of a day". */
const lastVisitDayAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)

/** Home appeared: whether it is the first time today. */
export function homeAppeared(registry: Registry, now: Date): boolean {
  const today = dayKey(now)
  const first = registry.get(lastVisitDayAtom) !== today
  registry.set(lastVisitDayAtom, today)
  return first
}

/**
 * What Home shows from now on: the items of `shown` in their order, each
 * with the newest `aiTitle` and topic art the engine has for it (a text
 * swap in a one-line title, and art that fades in over its placeholder, so
 * nothing moves). Returns `shown` itself when nothing changed, so React
 * keeps the rows.
 */
export function freezeHome(shown: HomeView, latest: HomeView): HomeView {
  let changed = false
  const items = shown.items.map((item): HomeItem => {
    const next = latest.items.find((candidate) => candidate.id === item.id)
    if (next === undefined) return item
    const aiTitle = next.aiTitle ?? item.aiTitle
    const topics = item.topics.map((topic) => {
      const art = next.topics.find((candidate) => candidate.id === topic.id)?.art
      return art === undefined || art === topic.art ? topic : { ...topic, art }
    })
    const artChanged = topics.some((topic, index) => topic !== item.topics[index])
    if (aiTitle === item.aiTitle && !artChanged) return item
    changed = true
    return { ...item, ...(aiTitle === undefined ? {} : { aiTitle }), topics }
  })
  return changed ? { ...shown, items } : shown
}

/** What one Home on screen showed when it appeared (the home README, "Items do not refresh"). */
export interface HomeShown {
  readonly view: HomeView
  readonly scene: HomeScene
  readonly title: string
  /** Under the greeting only while the first sync runs (`HOME_SYNCING_LINE`). */
  readonly line: string | undefined
  readonly now: number
  readonly caughtUp: boolean
  /** Play the entrance: the first appearance, not a return from a hidden tab. */
  readonly enter: boolean
  /** Items whose Mark done or Resolve all was used. */
  readonly used: ReadonlySet<string>
  /** The first sync is still running: the greeting shows with `HOME_SYNCING_LINE`, and items fill in as they land. */
  readonly loading: boolean
  /** Row slots held through the first sync's visit: rows that land later fill them, so nothing shown moves. */
  readonly reservedItems: number
}

/**
 * `shown`, then the items of `latest` it lacks, in `latest`'s order, up to
 * `limit`. Returns `shown` itself when nothing was added.
 */
export function addHomeItems(shown: ReadonlyArray<HomeItem>, latest: ReadonlyArray<HomeItem>, limit: number): ReadonlyArray<HomeItem> {
  const added = latest.filter((item) => !shown.some((old) => old.id === item.id)).slice(0, Math.max(0, limit - shown.length))
  return added.length === 0 ? shown : [...shown, ...added]
}

/** Home's second line until the first sync is done: present tense, names what is happening (SPEC 17). */
export const HOME_SYNCING_LINE = 'Syncing with Slack.'

/** By a key of the Home component's own, so two Homes never share one. Reset when nothing reads it. */
export const homeShownAtom = Atom.family((_key: string) => Atom.make<HomeShown | undefined>(undefined))

/**
 * Home appeared (mounted, shown again, or its first value arrived): takes
 * the items, the copy and the scene now, or nothing while there is no
 * value yet. Before the first sync is done it shows the greeting with
 * `HOME_SYNCING_LINE`, never a blank page and never "All caught up", and
 * reserves the rows' slots; `fillHome` adds items to them as they land.
 * When the sync ends, the rows already shown stay where they are, the
 * free slots take the next items, and the scene stays.
 */
export function showHome(registry: Registry, key: string, options: { readonly windowHeight: number; readonly enter: boolean; readonly welcome?: boolean }): void {
  const result = registry.get(homeViewAtom)
  if (result._tag !== 'Success') return registry.set(homeShownAtom(key), undefined)
  const now = new Date()
  const previous = registry.get(homeShownAtom(key))
  const limit = homeItemLimit(options.windowHeight, options.welcome)
  const syncing = previous?.loading === true
  if (!result.value.ready) {
    const greeting = homeGreeting({ now, firstName: result.value.firstName, caughtUp: false })
    return registry.set(homeShownAtom(key), {
      view: { ...result.value, items: addHomeItems(syncing ? previous.view.items : [], result.value.items, limit) },
      scene: previous?.loading === true ? previous.scene : homeScene({ now, caughtUp: false, firstVisitToday: homeAppeared(registry, now) }),
      title: greeting.title,
      line: HOME_SYNCING_LINE,
      now: now.getTime(),
      caughtUp: false,
      enter: options.enter,
      used: syncing ? previous.used : new Set<string>(),
      loading: true,
      reservedItems: limit,
    })
  }
  const view = result.value
  // Rows shown while syncing keep their places; the free slots take the next items.
  const items = syncing ? addHomeItems(previous.view.items, view.items, previous.reservedItems) : view.items.slice(0, limit)
  const shown = { ...view, items }
  const done = caughtUp(shown)
  const greeting = homeGreeting({ now, firstName: view.firstName, caughtUp: done })
  registry.set(homeShownAtom(key), {
    view: shown,
    // Coming out of the syncing state the scene stays, unless there is nothing to do.
    scene: syncing && !done ? previous.scene : homeScene({ now, caughtUp: done, firstVisitToday: homeAppeared(registry, now) }),
    ...greeting,
    line: undefined,
    now: now.getTime(),
    caughtUp: done,
    enter: options.enter,
    used: syncing ? previous.used : new Set<string>(),
    loading: false,
    // The reserved slots stay until Home appears again, so nothing moves.
    reservedItems: syncing ? previous.reservedItems : 0,
  })
}

/** During the first sync: adds the items that landed since, into the free slots. */
export function fillHome(registry: Registry, key: string): void {
  const shown = registry.get(homeShownAtom(key))
  const result = registry.get(homeViewAtom)
  if (shown?.loading !== true || result._tag !== 'Success' || result.value.ready) return
  const items = addHomeItems(shown.view.items, result.value.items, shown.reservedItems)
  if (items !== shown.view.items) registry.set(homeShownAtom(key), { ...shown, view: { ...shown.view, items } })
}

/** A row's button was used: it goes, its slot stays. */
export function markHomeItemUsed(registry: Registry, key: string, itemId: string): void {
  const shown = registry.get(homeShownAtom(key))
  if (shown !== undefined) registry.set(homeShownAtom(key), { ...shown, used: new Set([...shown.used, itemId]) })
}

/**
 * Follows the active tab and records a topic once it has been on screen
 * for `VISIT_MILLIS`, and again when it leaves, so the engine knows the
 * last topic the user had open. Returns the stop function.
 */
export function startVisitLog(registry: Registry): () => void {
  let current: { readonly id: string; timer: ReturnType<typeof setTimeout> | undefined; counted: boolean } | undefined
  const visit = (id: string) => void runCommand(registry, homeVisit, { id })
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
  }
}

/** Home showed Automated's record card: it waits a day before it shows again (SPEC 12). Its moves stay. */
export function markMovesShown(registry: Registry): void {
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

const savedTidyUpAtom = liveQuery(prefsGet)({ key: TIDY_UP_PREF })

/** Settings › Tidy up, with the defaults for what was never saved. */
export const tidyUpPrefsAtom = Atom.make((get): TidyUpPrefs => {
  const saved = get(savedTidyUpAtom)
  return tidyUpPrefsOf(AsyncResult.isSuccess(saved) ? saved.value : undefined)
})

export function setTidyUpPrefs(registry: Registry, prefs: TidyUpPrefs): void {
  void runCommand(registry, prefsSet, { key: TIDY_UP_PREF, value: prefs })
}
