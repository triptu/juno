/**
 * Topic tabs (spec section 6, performance 4.3 and 4.5).
 *
 * The rules are pure functions over `Tabs`:
 * - `openTab`: a topic opens in the current tab, or in a new one after the
 *   current tab when asked (⌘-click, ⌘-Enter, Open in new tab). A topic
 *   that is already open focuses its tab instead.
 * - `closeTab`: closing the active tab focuses its right neighbour, or its
 *   left one when it was the last. Closing the last tab leaves none.
 * - `activateTab`, `cycleTab` (⌘⇧] and ⌘⇧[).
 * - `mountedTabs`: the active tab and the 4 most recently active stay
 *   mounted in `<Activity>`; the rest unmount and keep a `ScrollSnapshot`.
 *
 * `tabsAtom` holds the tabs of the signed-in workspace. They are saved to
 * the workspace preference `TABS_PREF` on every change and read back from
 * it after a restart. `updateTabs` is the one way to change them.
 */
import { Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { prefsGet, prefsSet, type TopicDetail } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { topicAtom } from './messages'
import { signedInAtom } from './session'

/** One open topic. A topic is open in at most one tab, so its id is the tab's. */
export interface TopicTab {
  readonly id: string
}

export interface Tabs {
  /** In strip order. */
  readonly tabs: ReadonlyArray<TopicTab>
  readonly active: string | undefined
  /** Tab ids, the most recently active first. */
  readonly recent: ReadonlyArray<string>
}

export const noTabs: Tabs = { tabs: [], active: undefined, recent: [] }

/** Tabs kept mounted: the active one and the 4 most recently active (performance 4.3). */
export const MOUNTED_TABS = 5

export interface OpenOptions {
  /** A new tab after the current one, instead of the current tab. */
  readonly newTab?: boolean
}

const touch = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> => (recent[0] === id ? recent : [id, ...recent.filter((other) => other !== id)])

export function activateTab(tabs: Tabs, id: string): Tabs {
  if (!tabs.tabs.some((tab) => tab.id === id)) return tabs
  if (tabs.active === id && tabs.recent[0] === id) return tabs
  return { ...tabs, active: id, recent: touch(tabs.recent, id) }
}

export function openTab(tabs: Tabs, id: string, { newTab = false }: OpenOptions = {}): Tabs {
  if (tabs.tabs.some((tab) => tab.id === id)) return activateTab(tabs, id)
  const tab: TopicTab = { id }
  const at = tabs.tabs.findIndex((other) => other.id === tabs.active)
  if (at < 0) return { tabs: [...tabs.tabs, tab], active: id, recent: touch(tabs.recent, id) }
  if (newTab) return { tabs: tabs.tabs.toSpliced(at + 1, 0, tab), active: id, recent: touch(tabs.recent, id) }
  const replaced = tabs.tabs[at]!.id
  return { tabs: tabs.tabs.with(at, tab), active: id, recent: touch(tabs.recent.filter((other) => other !== replaced), id) }
}

export function closeTab(tabs: Tabs, id: string): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  if (at < 0) return tabs
  const rest = tabs.tabs.toSpliced(at, 1)
  const recent = tabs.recent.filter((other) => other !== id)
  if (tabs.active !== id) return { ...tabs, tabs: rest, recent }
  const neighbour = rest[Math.min(at, rest.length - 1)]
  return { tabs: rest, active: neighbour?.id, recent: neighbour === undefined ? recent : touch(recent, neighbour.id) }
}

/** The next (1) or previous (-1) tab, wrapping around. */
export function cycleTab(tabs: Tabs, step: 1 | -1): Tabs {
  const count = tabs.tabs.length
  if (count < 2) return tabs
  const at = Math.max(0, tabs.tabs.findIndex((tab) => tab.id === tabs.active))
  return activateTab(tabs, tabs.tabs[(at + step + count) % count]!.id)
}

/** The tabs that stay mounted. */
export function mountedTabs(tabs: Tabs): ReadonlySet<string> {
  const mounted = new Set<string>()
  if (tabs.active !== undefined) mounted.add(tabs.active)
  for (const id of tabs.recent) {
    if (mounted.size >= MOUNTED_TABS) break
    mounted.add(id)
  }
  return mounted
}

/**
 * Where the "N new" divider goes: the index of the first message after the
 * read pointer, or -1 when every message is read or none is (a topic never
 * read opens at the bottom with no divider).
 */
export function dividerIndex(order: ReadonlyArray<string>, lastReadTs: string | undefined): number {
  if (lastReadTs === undefined) return -1
  return order.findIndex((ts) => ts > lastReadTs)
}

// Persistence

/** The workspace preference that holds the tabs. */
export const TABS_PREF = 'tabs'

const TabsJson = Schema.Struct({
  tabs: Schema.Array(Schema.Struct({ id: Schema.String })),
  active: Schema.NullOr(Schema.String),
  recent: Schema.Array(Schema.String),
})
const decodeTabs = Schema.decodeUnknownOption(TabsJson)

/** Saved tabs as `Tabs`. Anything else, an older shape included, is no tabs. */
export function parseTabs(value: unknown): Tabs {
  return Option.match(decodeTabs(value), {
    onNone: () => noTabs,
    onSome: (saved) => {
      const ids = new Set(saved.tabs.map((tab) => tab.id))
      if (ids.size !== saved.tabs.length) return noTabs
      const active = saved.active !== null && ids.has(saved.active) ? saved.active : saved.tabs[0]?.id
      const recent = saved.recent.filter((id) => ids.has(id))
      return { tabs: saved.tabs, active, recent: active === undefined ? recent : touch(recent, active) }
    },
  })
}

const savedTabsAtom = liveQuery(prefsGet)({ key: TABS_PREF })

/** Tabs changed in this run of the app, per workspace. Until the first change, the saved ones show. */
const changedTabsAtom = Atom.family((_teamId: string) => Atom.make<Tabs | undefined>(undefined).pipe(Atom.keepAlive))

/** The open tabs of the signed-in workspace. */
export const tabsAtom = Atom.make((get): Tabs => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return noTabs
  const changed = get(changedTabsAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedTabsAtom)
  return AsyncResult.isSuccess(saved) ? parseTabs(saved.value) : noTabs
}).pipe(Atom.withEquality((a: Tabs, b: Tabs) => a === b))

/** Applies a rule to the tabs and saves the result. */
export function updateTabs(registry: Registry, change: (tabs: Tabs) => Tabs): Tabs {
  const teamId = registry.get(signedInAtom)?.teamId
  const current = registry.get(tabsAtom)
  if (teamId === undefined) return current
  const next = change(current)
  if (next === current) return current
  registry.set(changedTabsAtom(teamId), next)
  void runCommand(registry, prefsSet, { key: TABS_PREF, value: { tabs: next.tabs, active: next.active ?? null, recent: next.recent } })
  return next
}

/** A tab as the strip draws it. */
export interface TabSummary {
  readonly id: string
  /** The topic's header: undefined until it arrives, null for a topic the store does not know. */
  readonly detail: TopicDetail | null | undefined
}

const sameStrip = (a: ReadonlyArray<TabSummary>, b: ReadonlyArray<TabSummary>) => a.length === b.length && a.every((tab, i) => tab === b[i])

/** The tabs with their headers, for the strip. A tab keeps its object while its header holds. */
export const tabStripAtom = Atom.make((get): ReadonlyArray<TabSummary> => {
  const previous = new Map(Option.getOrElse(get.self<ReadonlyArray<TabSummary>>(), () => []).map((tab) => [tab.id, tab]))
  return get(tabsAtom).tabs.map((tab) => {
    const result = get(topicAtom(tab.id))
    const detail = AsyncResult.isSuccess(result) ? result.value : undefined
    const held = previous.get(tab.id)
    return held !== undefined && held.detail === detail ? held : { ...tab, detail }
  })
}).pipe(Atom.withEquality(sameStrip))

/** Where an unmounted tab was scrolled: the first row in view and its offset from the top of the list. */
export interface ScrollSnapshot {
  readonly anchorKey: string
  readonly offset: number
}

/** Each tab's last scroll position, kept while the app runs. */
export const scrollSnapshotAtom = Atom.family((_tabId: string) => Atom.make<ScrollSnapshot | undefined>(undefined).pipe(Atom.keepAlive))
