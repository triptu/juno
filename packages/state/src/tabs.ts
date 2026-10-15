/**
 * Workspace tabs (spec section 6, inventory 4, performance 4.3 and 4.5).
 *
 * A tab shows one place, a topic, a New chat or a page (Home, All topics, Notifications, Preferences, the Juno chat or a Juno page), and keeps its own
 * history of the places it showed, like a browser tab. The rules are pure
 * functions over `Tabs`:
 * - `openPlace`: a place opens in the current tab (a new history entry), or
 *   in a new tab after it when asked (⌘-click, ⌘-Enter, Open in new tab,
 *   ⌘T). A topic or page that a tab already shows focuses that tab instead.
 * - `settleNewChat`: a New chat that sent becomes the topic it sent to, in
 *   place of its own entry, or closes when another tab shows that topic.
 * - `stepHistory` (Back and Forward), `goToEntry` (the history menu).
 * - `closeTab`, `closeOtherTabs`, `closeTabsToRight`, `closeAllTabs`: every
 *   closed tab goes onto the reopen stack with its history; `reopenClosedTab`
 *   (⌘⇧T) takes the last one back. The bulk closes leave pinned tabs open.
 * - `setPinned`: pinned tabs sit first, in pin order.
 * - `activateTab`, `cycleTab` (⌃Tab, ⌘⇧] and ⌘⇧[), `tabByNumber` (⌘1 to ⌘9).
 * - `mountedTabs`: the active tab and the 4 most recently active stay
 *   mounted in `<Activity>`; the rest unmount and keep a `ScrollSnapshot`.
 *
 * `tabsAtom` holds the tabs of the signed-in workspace. They are saved to
 * the workspace preference `TABS_PREF` on every change and read back from
 * it after a restart, with their pinned flags and the place each shows. History and the reopen stack are in memory only.
 * `updateTabs` is the one way to change them.
 */
import { Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { JunoPage } from '@juno/agent-contract'
import { prefsGet, prefsSet, type TopicDetail } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { topicAtom } from './messages'
import { newChatAtom, newChatTitle } from './newChat'
import { signedInAtom } from './session'

/** What a tab shows: a topic, a New chat (spec section 9), or a page: Home (section 12), All topics (section 11), Notifications or Preferences (section 14), the Juno chat (section 13) or a Juno page (13.10). */
export type Place =
  | { readonly kind: 'topic'; readonly topicId: string }
  | { readonly kind: 'newChat' }
  | { readonly kind: 'home' }
  | { readonly kind: 'allTopics' }
  | { readonly kind: 'notifications' }
  | { readonly kind: 'preferences' }
  | { readonly kind: 'juno' }
  /** A page behind the Juno menu, or Settings › Juno (SPEC 13.10). One tab per page. */
  | { readonly kind: 'junoPage'; readonly page: JunoPage }

export const newChatPlace: Place = { kind: 'newChat' }
export const homePlace: Place = { kind: 'home' }
export const allTopicsPlace: Place = { kind: 'allTopics' }
export const notificationsPlace: Place = { kind: 'notifications' }
export const preferencesPlace: Place = { kind: 'preferences' }
export const junoPlace: Place = { kind: 'juno' }
export const junoPagePlace = (page: JunoPage): Place => ({ kind: 'junoPage', page })
export const topicPlace = (topicId: string): Place => ({ kind: 'topic', topicId })

/** The places a tab showed, oldest first, and the one it shows. */
export interface TabHistory {
  readonly entries: ReadonlyArray<Place>
  readonly index: number
}

export interface Tab {
  readonly id: string
  readonly pinned: boolean
  readonly history: TabHistory
}

/** A closed tab and where it was in the strip. */
export interface ClosedTab {
  readonly tab: Tab
  readonly index: number
}

export interface Tabs {
  /** In strip order, pinned tabs first. */
  readonly tabs: ReadonlyArray<Tab>
  readonly active: string | undefined
  /** Tab ids, the most recently active first. */
  readonly recent: ReadonlyArray<string>
  /** Closed tabs, the last closed at the end. */
  readonly closed: ReadonlyArray<ClosedTab>
}

export const noTabs: Tabs = { tabs: [], active: undefined, recent: [], closed: [] }

/** Tabs kept mounted: the active one and the 4 most recently active (performance 4.3). */
export const MOUNTED_TABS = 5
/** History entries a tab keeps (inventory 4). */
export const HISTORY_LIMIT = 50
/** Closed tabs ⌘⇧T can bring back. */
export const CLOSED_LIMIT = 20

export interface OpenOptions {
  /** A new tab after the current one, instead of the current tab. */
  readonly newTab?: boolean
}

export const currentPlace = (tab: Tab): Place => tab.history.entries[tab.history.index]!
/** The topic a tab shows, if it shows one. */
export function tabTopic(tab: Tab): string | undefined {
  const place = currentPlace(tab)
  return place.kind === 'topic' ? place.topicId : undefined
}
const samePlace = (a: Place, b: Place) =>
  a.kind === 'topic' ? b.kind === 'topic' && a.topicId === b.topicId : a.kind === 'junoPage' ? b.kind === 'junoPage' && a.page === b.page : a.kind === b.kind

export const activeTab = (tabs: Tabs): Tab | undefined => tabs.tabs.find((tab) => tab.id === tabs.active)
/** The tab that shows `topicId`, if one does. */
export const tabShowing = (tabs: Tabs, topicId: string): Tab | undefined => tabs.tabs.find((tab) => tabTopic(tab) === topicId)
/** The tab that shows a page. Pages are singletons. */
const pageTab = (tabs: Tabs, kind: Place['kind']): Tab | undefined => tabs.tabs.find((tab) => currentPlace(tab).kind === kind)
/** The tab that shows All topics, if one does. All topics is a singleton. */
export const allTopicsTab = (tabs: Tabs): Tab | undefined => pageTab(tabs, 'allTopics')
const pinnedCount = (tabs: ReadonlyArray<Tab>) => tabs.filter((tab) => tab.pinned).length

/** A tab id no open or closed tab has. Ids are `tab-<n>`, so the next is one past the highest. */
function nextTabId(tabs: Tabs): string {
  let highest = 0
  for (const tab of [...tabs.tabs, ...tabs.closed.map((closed) => closed.tab)]) {
    const n = Number(tab.id.slice(4))
    if (tab.id.startsWith('tab-') && Number.isInteger(n)) highest = Math.max(highest, n)
  }
  return `tab-${highest + 1}`
}

const touch = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> => (recent[0] === id ? recent : [id, ...recent.filter((other) => other !== id)])

export function activateTab(tabs: Tabs, id: string): Tabs {
  if (!tabs.tabs.some((tab) => tab.id === id)) return tabs
  if (tabs.active === id && tabs.recent[0] === id) return tabs
  return { ...tabs, active: id, recent: touch(tabs.recent, id) }
}

const freshTab = (id: string, place: Place): Tab => ({ id, pinned: false, history: { entries: [place], index: 0 } })

/** `place` as the tab's next entry. Forward is dropped. An empty New chat is replaced, not kept. */
function push(history: TabHistory, place: Place): TabHistory {
  const kept = history.entries[history.index]!.kind === 'newChat' ? history.index : history.index + 1
  const entries = [...history.entries.slice(0, kept), place].slice(-HISTORY_LIMIT)
  return { entries, index: entries.length - 1 }
}

export function openPlace(tabs: Tabs, place: Place, { newTab = false }: OpenOptions = {}): Tabs {
  // A topic and each page show in at most one tab (a Juno page per page): opening one again focuses it.
  const showing = place.kind === 'newChat' ? undefined : tabs.tabs.find((tab) => samePlace(currentPlace(tab), place))
  if (showing !== undefined) return activateTab(tabs, showing.id)
  const at = tabs.tabs.findIndex((tab) => tab.id === tabs.active)
  if (at < 0 || newTab) {
    const tab = freshTab(nextTabId(tabs), place)
    // A new tab never lands among the pinned ones.
    const index = at < 0 ? tabs.tabs.length : Math.max(at + 1, pinnedCount(tabs.tabs))
    return { ...tabs, tabs: tabs.tabs.toSpliced(index, 0, tab), active: tab.id, recent: touch(tabs.recent, tab.id) }
  }
  const current = tabs.tabs[at]!
  if (samePlace(currentPlace(current), place)) return tabs
  const tab: Tab = { ...current, history: push(current.history, place) }
  return { ...tabs, tabs: tabs.tabs.with(at, tab), recent: touch(tabs.recent, tab.id) }
}

/**
 * After a New chat in tab `tabId` sent to `topicId`: the tab shows the topic
 * in place of the New chat's entry, so Back goes to what the tab showed
 * before. If another tab already shows the topic, that tab is focused and
 * the New chat tab closes; it does not go onto the reopen stack.
 */
export function settleNewChat(tabs: Tabs, tabId: string, topicId: string): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === tabId)
  const tab = tabs.tabs[at]
  if (tab === undefined || currentPlace(tab).kind !== 'newChat') return tabs
  const showing = tabShowing(tabs, topicId)
  if (showing !== undefined) {
    const closed = closeTab(tabs, tabId)
    return activateTab({ ...closed, closed: tabs.closed }, showing.id)
  }
  const entries = [...tab.history.entries.slice(0, tab.history.index), topicPlace(topicId)]
  return { ...tabs, tabs: tabs.tabs.with(at, { ...tab, history: { entries, index: entries.length - 1 } }) }
}

/** The place Back (-1) or Forward (1) would show in the active tab, if there is one. */
export function historyTarget(tabs: Tabs, step: 1 | -1): Place | undefined {
  const tab = activeTab(tabs)
  return tab?.history.entries[tab.history.index + step]
}

/** Shows entry `index` of the active tab's history. */
export function goToEntry(tabs: Tabs, index: number): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === tabs.active)
  const tab = tabs.tabs[at]
  if (tab === undefined || index === tab.history.index || index < 0 || index >= tab.history.entries.length) return tabs
  return { ...tabs, tabs: tabs.tabs.with(at, { ...tab, history: { ...tab.history, index } }) }
}

/** Back (-1) or Forward (1) in the active tab. */
export function stepHistory(tabs: Tabs, step: 1 | -1): Tabs {
  const tab = activeTab(tabs)
  return tab === undefined ? tabs : goToEntry(tabs, tab.history.index + step)
}

export function closeTab(tabs: Tabs, id: string): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  if (at < 0) return tabs
  const rest = tabs.tabs.toSpliced(at, 1)
  const recent = tabs.recent.filter((other) => other !== id)
  const closed = [...tabs.closed, { tab: tabs.tabs[at]!, index: at }].slice(-CLOSED_LIMIT)
  if (tabs.active !== id) return { ...tabs, tabs: rest, recent, closed }
  const neighbour = rest[Math.min(at, rest.length - 1)]
  return { tabs: rest, active: neighbour?.id, recent: neighbour === undefined ? recent : touch(recent, neighbour.id), closed }
}

/** Closes `ids` from the right, so ⌘⇧T brings them back left to right, each at its old place. */
function closeEach(tabs: Tabs, ids: ReadonlyArray<string>): Tabs {
  return ids.toReversed().reduce(closeTab, tabs)
}

const unpinnedIds = (tabs: ReadonlyArray<Tab>) => tabs.filter((tab) => !tab.pinned).map((tab) => tab.id)

/** Close other tabs: every unpinned tab but `id`, which becomes active. */
export function closeOtherTabs(tabs: Tabs, id: string): Tabs {
  return activateTab(closeEach(tabs, unpinnedIds(tabs.tabs).filter((other) => other !== id)), id)
}

/** Close tabs to the right: the unpinned tabs after `id`. */
export function closeTabsToRight(tabs: Tabs, id: string): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  return at < 0 ? tabs : closeEach(tabs, unpinnedIds(tabs.tabs.slice(at + 1)))
}

/** Close all tabs: every unpinned tab. */
export function closeAllTabs(tabs: Tabs): Tabs {
  return closeEach(tabs, unpinnedIds(tabs.tabs))
}

/** ⌘⇧T: the last closed tab, back at its old index (within its pinned or unpinned group) with its history, and active. */
export function reopenClosedTab(tabs: Tabs): Tabs {
  const last = tabs.closed.at(-1)
  if (last === undefined) return tabs
  const pinned = pinnedCount(tabs.tabs)
  const index = last.tab.pinned ? Math.min(last.index, pinned) : Math.min(Math.max(last.index, pinned), tabs.tabs.length)
  return { tabs: tabs.tabs.toSpliced(index, 0, last.tab), active: last.tab.id, recent: touch(tabs.recent, last.tab.id), closed: tabs.closed.slice(0, -1) }
}

/** Pins a tab after the pinned ones, or unpins it to the first unpinned place. */
export function setPinned(tabs: Tabs, id: string, pinned: boolean): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  const tab = tabs.tabs[at]
  if (tab === undefined || tab.pinned === pinned) return tabs
  const rest = tabs.tabs.toSpliced(at, 1)
  return { ...tabs, tabs: rest.toSpliced(pinnedCount(rest), 0, { ...tab, pinned }) }
}

/** The next (1) or previous (-1) tab, wrapping around. */
export function cycleTab(tabs: Tabs, step: 1 | -1): Tabs {
  const count = tabs.tabs.length
  if (count < 2) return tabs
  const at = Math.max(0, tabs.tabs.findIndex((tab) => tab.id === tabs.active))
  return activateTab(tabs, tabs.tabs[(at + step + count) % count]!.id)
}

/** ⌘1 to ⌘8: the tab at that position, pinned tabs included. ⌘9: the last tab. */
export function tabByNumber(tabs: Tabs, n: number): Tab | undefined {
  return n === 9 ? tabs.tabs.at(-1) : tabs.tabs[n - 1]
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
 * read pointer that the user did not send (`mine`), or -1 when every message
 * is read or none is (a topic never read opens at the bottom with no
 * divider). The user's own messages, sent or still sending, are never new.
 */
export function dividerIndex(order: ReadonlyArray<string>, lastReadTs: string | undefined, mine: (ts: string) => boolean = () => false): number {
  if (lastReadTs === undefined) return -1
  return order.findIndex((ts) => !mine(ts) && ts > lastReadTs)
}

// Persistence

/** The workspace preference that holds the tabs. */
export const TABS_PREF = 'tabs'

const PlaceJson = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('topic'), topicId: Schema.String }),
  Schema.Struct({ kind: Schema.Literals(['newChat', 'home', 'allTopics', 'notifications', 'preferences', 'juno']) }),
  Schema.Struct({ kind: Schema.Literal('junoPage'), page: JunoPage }),
])
/**
 * A saved tab, or one saved before history, when a tab's id was its
 * topic's. Tabs saved with the old `stealth` flag still read back; the flag
 * is dropped.
 */
const TabJson = Schema.Union([Schema.Struct({ id: Schema.String, pinned: Schema.Boolean, place: PlaceJson }), Schema.Struct({ id: Schema.String })])
const TabsJson = Schema.Struct({
  tabs: Schema.Array(TabJson),
  active: Schema.NullOr(Schema.String),
  recent: Schema.Array(Schema.String),
})
const decodeTabs = Schema.decodeUnknownOption(TabsJson)

/** Saved tabs as `Tabs`, each with a history of the one place it showed. Anything unreadable is no tabs. */
export function parseTabs(value: unknown): Tabs {
  return Option.match(decodeTabs(value), {
    onNone: () => noTabs,
    onSome: (saved) => {
      const ids = new Set(saved.tabs.map((tab) => tab.id))
      if (ids.size !== saved.tabs.length) return noTabs
      const tabs = saved.tabs.map((tab): Tab => ('place' in tab ? { id: tab.id, pinned: tab.pinned, history: { entries: [tab.place], index: 0 } } : freshTab(tab.id, topicPlace(tab.id))))
      const ordered = [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
      const active = saved.active !== null && ids.has(saved.active) ? saved.active : ordered[0]?.id
      const recent = saved.recent.filter((id) => ids.has(id))
      return { tabs: ordered, active, recent: active === undefined ? recent : touch(recent, active), closed: [] }
    },
  })
}

/** What `TABS_PREF` holds: each tab with the place it shows. */
export function savedTabs(tabs: Tabs): unknown {
  return {
    tabs: tabs.tabs.map((tab) => ({ id: tab.id, pinned: tab.pinned, place: currentPlace(tab) })),
    active: tabs.active ?? null,
    recent: tabs.recent,
  }
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
  void runCommand(registry, prefsSet, { key: TABS_PREF, value: savedTabs(next) })
  return next
}

/** Whether the active tab can go Back and Forward, for the title bar buttons. */
export interface HistoryState {
  readonly back: boolean
  readonly forward: boolean
}

const noHistory: HistoryState = { back: false, forward: false }

export const historyStateAtom = Atom.make((get): HistoryState => {
  const tabs = get(tabsAtom)
  const back = historyTarget(tabs, -1) !== undefined
  const forward = historyTarget(tabs, 1) !== undefined
  return back || forward ? { back, forward } : noHistory
}).pipe(Atom.withEquality((a: HistoryState, b: HistoryState) => a.back === b.back && a.forward === b.forward))

/** A tab as the strip draws it. */
export interface TabSummary {
  readonly id: string
  readonly pinned: boolean
  readonly place: Place
  /** A topic's header: undefined until it arrives (and for a page), null for a topic the store does not know. */
  readonly detail: TopicDetail | null | undefined
  /** A New chat's title: "New chat", then its destination's name. */
  readonly chatTitle?: string
}

const sameStrip = (a: ReadonlyArray<TabSummary>, b: ReadonlyArray<TabSummary>) => a.length === b.length && a.every((tab, i) => tab === b[i])

/**
 * The tabs with their headers, for the strip. The header carries the
 * topic's unread count, so the unread dot costs no extra query. A tab keeps
 * its object while its flags, place and header hold.
 */
export const tabStripAtom = Atom.make((get): ReadonlyArray<TabSummary> => {
  const previous = new Map(Option.getOrElse(get.self<ReadonlyArray<TabSummary>>(), () => []).map((tab) => [tab.id, tab]))
  return get(tabsAtom).tabs.map((tab) => {
    const place = currentPlace(tab)
    const result = place.kind === 'topic' ? get(topicAtom(place.topicId)) : undefined
    const detail = result !== undefined && AsyncResult.isSuccess(result) ? result.value : undefined
    const chatTitle = place.kind === 'newChat' ? newChatTitle(get(newChatAtom(tab.id))) : undefined
    const held = previous.get(tab.id)
    return held !== undefined && held.pinned === tab.pinned && samePlace(held.place, place) && held.detail === detail && held.chatTitle === chatTitle
      ? held
      : { id: tab.id, pinned: tab.pinned, place, detail, ...(chatTitle === undefined ? {} : { chatTitle }) }
  })
}).pipe(Atom.withEquality(sameStrip))

/** Where an unmounted tab was scrolled: the first row in view and its offset from the top of the list. */
export interface ScrollSnapshot {
  readonly anchorKey: string
  readonly offset: number
}

/** Each topic's last scroll position, kept while the app runs, so Back and ⌘⇧T return to where it was left. */
export const scrollSnapshotAtom = Atom.family((_topicId: string) => Atom.make<ScrollSnapshot | undefined>(undefined).pipe(Atom.keepAlive))
