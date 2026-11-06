/**
 * Workspace tabs (spec section 6, inventory 4, performance 4.3 and 4.5).
 *
 * A tab shows one place, a topic or a page (Home, All topics, Settings, the Juno chat or a Juno page), and keeps its own
 * history of the places it showed, like a browser tab. The rules are pure
 * functions over `Tabs`:
 * - `openPlace`: a place opens in the current tab (a new history entry), or
 *   in a new tab after it when asked (⌘-click, ⌘-Enter, Open in new tab,
 *   ⌘T). A plain open of a topic or page that a tab already shows focuses
 *   that tab; a new tab always opens, so one place can show in several tabs.
 * - `ensureTab`: there is never no tab. Closing the last one, or a launch
 *   with none saved, leaves one tab with Home.
 * - `openSettingsSection`: Settings at a section, in the tab that shows
 *   Settings if one does, where the section replaces the one it showed.
 * - `stepHistory` (Back and Forward), `goToEntry` (the history menu).
 * - `closeTab`, `closeOtherTabs`, `closeTabsToRight`, `closeAllTabs`: every
 *   closed tab goes onto the reopen stack with its history; `reopenClosedTab`
 *   (⌘⇧T) takes the last one back. The bulk closes leave pinned tabs open.
 * - `setPinned`: pinned tabs sit first, in pin order.
 * - `stampViewed` and `expireTabs`: a tab not viewed for the time Settings ›
 *   General chooses closes by itself, onto the reopen stack, unless it is
 *   active or holds an unsent draft.
 * - `moveTab`: a tab dragged, or moved with ⌃⇧← and ⌃⇧→, to another place
 *   in the strip, within its pinned or unpinned group.
 * - `activateTab`, `cycleTab` (⌃Tab, ⌘⇧] and ⌘⇧[), `tabByNumber` (⌘1 to ⌘9).
 * - `mountedTabs`: the active tab and the 4 most recently active stay
 *   mounted in `<Activity>`; the rest unmount and keep a `ScrollSnapshot`.
 *
 * `tabsAtom` holds the tabs of the signed-in workspace. They are saved to
 * the workspace preference `TABS_PREF` on every change and read back from
 * it after a restart, with their pinned flags, the place each shows and when each was last viewed. History and the reopen stack are in memory only.
 * `updateTabs` is the one way to change them.
 */
import { Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { JunoPage } from '@juno/agent-contract'
import { mainTopicOf, PickConversation, prefsGet, prefsSet, SettingsSectionSchema, type SettingsSection, type TopicDetail } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { topicAtom } from './messages'
import { homeDraftAtom, untouched, type HomeDraft } from './homeDraft'
import { decodeSearchSession, searchSessionAtom, searchTitleAtom, type SearchSession } from './search'
import { signedInAtom } from './session'

/** The Juno menu's pages that have a tab of their own. Its Connections and Settings are sections of Settings. */
export type JunoTabPage = Exclude<JunoPage, 'settings' | 'connections'>

/** What a Juno tab or the Juno panel shows: the chat, or one of its pages. */
export type JunoView = 'chat' | JunoTabPage

/** What a tab shows: a topic, or a page: Home (section 12), All topics (section 11), Settings at one of its sections (section 14), the Juno chat (section 13), a Juno page (13.10) or a channel's huddle (20). */
export type Place =
  | { readonly kind: 'topic'; readonly topicId: string; readonly viewId?: string }
  | { readonly kind: 'home' }
  | { readonly kind: 'allTopics' }
  /** One tab for Settings, whichever section it shows. */
  | { readonly kind: 'settings'; readonly section: SettingsSection }
  | { readonly kind: 'juno' }
  /** A page behind the Juno menu (SPEC 13.10). */
  | { readonly kind: 'junoPage'; readonly page: JunoTabPage }
  /** The huddle of a channel or DM, one tab per channel. */
  | { readonly kind: 'huddle'; readonly channelId: string }
  /** The developer log, opened from ⌘K. Never saved, so it does not come back at the next launch. */
  | { readonly kind: 'devLog' }
  /** The gallery of Home's pictures, or one picture with its story (SPEC 12, "Pictures and the gallery"). */
  | { readonly kind: 'gallery'; readonly pictureId?: string }
  /** A Search tab (SPEC 10a). Its field, selection and scroll are `searchSessionAtom(sessionId)`, saved with the tab. */
  | { readonly kind: 'search'; readonly sessionId: string }

export const homePlace: Place = { kind: 'home' }
export const allTopicsPlace: Place = { kind: 'allTopics' }
export const settingsPlace = (section: SettingsSection): Place => ({ kind: 'settings', section })
export const junoPlace: Place = { kind: 'juno' }
export const junoPagePlace = (page: JunoTabPage): Place => ({ kind: 'junoPage', page })
export const topicPlace = (topicId: string): Place => ({ kind: 'topic', topicId })
export const huddlePlace = (channelId: string): Place => ({ kind: 'huddle', channelId })
export const devLogPlace: Place = { kind: 'devLog' }
export const galleryPlace = (pictureId?: string): Place => (pictureId === undefined ? { kind: 'gallery' } : { kind: 'gallery', pictureId })
export const searchPlace = (sessionId: string): Place => ({ kind: 'search', sessionId })

/** The places a tab showed, oldest first, and the one it shows. */
export interface TabHistory {
  readonly entries: ReadonlyArray<Place>
  readonly index: number
}

export interface Tab {
  readonly id: string
  readonly pinned: boolean
  readonly history: TabHistory
  /** The Juno panel is open in this tab (SPEC 7). It shows while the tab shows a topic. */
  readonly junoPanel?: true
  /** When the tab was last on screen, in ms: stamped when it becomes active and when it is left. Saved with the tab. */
  readonly lastViewedAt?: number
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
  /** The number of the last tab id given out, so an id that fell off the reopen stack is not given out again: a tab's Home draft and Juno panel view are kept by its id. */
  readonly lastId?: number
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
  /** With `newTab`: the current tab stays active and the new one waits behind it, as ⌘-click on Start thread opens it. */
  readonly background?: boolean
  /** With `newTab`: the new tab goes right after this tab instead of the active one, if it is still open. */
  readonly after?: string
}

export const currentPlace = (tab: Tab): Place => tab.history.entries[tab.history.index]!
/** The topic a tab shows, if it shows one. */
export function tabTopic(tab: Tab): string | undefined {
  const place = currentPlace(tab)
  return place.kind === 'topic' ? place.topicId : undefined
}
/** Settings is one place whatever its section, so it shows in one tab. */
export const samePlace = (a: Place, b: Place) =>
  a.kind === 'topic' ? b.kind === 'topic' && a.topicId === b.topicId
  : a.kind === 'junoPage' ? b.kind === 'junoPage' && a.page === b.page
  : a.kind === 'huddle' ? b.kind === 'huddle' && a.channelId === b.channelId
  : a.kind === 'gallery' ? b.kind === 'gallery' && a.pictureId === b.pictureId
  : a.kind === 'search' ? b.kind === 'search' && a.sessionId === b.sessionId
  : a.kind === b.kind

export const activeTab = (tabs: Tabs): Tab | undefined => tabs.tabs.find((tab) => tab.id === tabs.active)
/**
 * The tab a plain open of `place` focuses: of the tabs that show it, the
 * one active most recently.
 */
export function tabShowingPlace(tabs: Tabs, place: Place): Tab | undefined {
  const showing = tabs.tabs.filter((tab) => samePlace(currentPlace(tab), place))
  if (showing.length < 2) return showing[0]
  const rank = (tab: Tab) => {
    if (tab.id === tabs.active) return -1
    const at = tabs.recent.indexOf(tab.id)
    return at < 0 ? tabs.recent.length : at
  }
  return showing.reduce((best, tab) => (rank(tab) < rank(best) ? tab : best))
}
/** The tab a plain open of `topicId` focuses, if a tab shows it. */
export const tabShowing = (tabs: Tabs, topicId: string): Tab | undefined => tabShowingPlace(tabs, topicPlace(topicId))
/** A tab that shows All topics, if one does. */
export const allTopicsTab = (tabs: Tabs): Tab | undefined => tabShowingPlace(tabs, allTopicsPlace)
const pinnedCount = (tabs: ReadonlyArray<Tab>) => tabs.filter((tab) => tab.pinned).length

/** A tab id no tab has had. Ids are `tab-<n>`, so the next is one past the highest given out or held. */
function nextTabId(tabs: Tabs): { readonly id: string; readonly lastId: number } {
  let highest = tabs.lastId ?? 0
  for (const tab of [...tabs.tabs, ...tabs.closed.map((closed) => closed.tab)]) {
    const n = Number(tab.id.slice(4))
    if (tab.id.startsWith('tab-') && Number.isInteger(n)) highest = Math.max(highest, n)
  }
  return { id: `tab-${highest + 1}`, lastId: highest + 1 }
}

const touch = (recent: ReadonlyArray<string>, id: string): ReadonlyArray<string> => (recent[0] === id ? recent : [id, ...recent.filter((other) => other !== id)])

export function activateTab(tabs: Tabs, id: string): Tabs {
  if (!tabs.tabs.some((tab) => tab.id === id)) return tabs
  if (tabs.active === id && tabs.recent[0] === id) return tabs
  return { ...tabs, active: id, recent: touch(tabs.recent, id) }
}

const freshTab = (id: string, place: Place): Tab => ({ id, pinned: false, history: { entries: [place], index: 0 } })

/** `place` as the tab's next entry. Forward is dropped. */
function push(history: TabHistory, place: Place): TabHistory {
  const entries = [...history.entries.slice(0, history.index + 1), place].slice(-HISTORY_LIMIT)
  return { entries, index: entries.length - 1 }
}

export function openPlace(tabs: Tabs, place: Place, { newTab = false, background = false, after }: OpenOptions = {}): Tabs {
  // A plain open of a place a tab shows focuses that tab. A new tab is always new, so a place can show in several.
  const showing = newTab ? undefined : tabShowingPlace(tabs, place)
  if (showing !== undefined) return activateTab(tabs, showing.id)
  const at = tabs.tabs.findIndex((tab) => tab.id === tabs.active)
  if (at < 0 || newTab) {
    const { id, lastId } = nextTabId(tabs)
    const tab = freshTab(id, place)
    const anchor = after === undefined ? -1 : tabs.tabs.findIndex((tab) => tab.id === after)
    const from = anchor >= 0 ? anchor : at
    // A new tab never lands among the pinned ones.
    const index = from < 0 ? tabs.tabs.length : Math.max(from + 1, pinnedCount(tabs.tabs))
    // A background tab is not viewed yet, so it is not among the recent ones either.
    if (background && at >= 0) return { ...tabs, tabs: tabs.tabs.toSpliced(index, 0, tab), lastId }
    return { ...tabs, tabs: tabs.tabs.toSpliced(index, 0, tab), active: tab.id, recent: touch(tabs.recent, tab.id), lastId }
  }
  const current = tabs.tabs[at]!
  if (samePlace(currentPlace(current), place)) return tabs
  const tab: Tab = { ...current, history: push(current.history, place) }
  return { ...tabs, tabs: tabs.tabs.with(at, tab), recent: touch(tabs.recent, tab.id) }
}

/**
 * `place` in the active tab, as a new history entry, even when another tab
 * shows it: the Juno header's switcher moves within its own tab, so Back
 * returns to where it was (SPEC 13.10). With no active tab, a plain open.
 */
export function showInActiveTab(tabs: Tabs, place: Place): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === tabs.active)
  if (at < 0) return openPlace(tabs, place)
  const current = tabs.tabs[at]!
  if (samePlace(currentPlace(current), place)) return tabs
  return { ...tabs, tabs: tabs.tabs.with(at, { ...current, history: push(current.history, place) }), recent: touch(tabs.recent, current.id) }
}

/** With no tab left, one tab that shows `place`, active. Otherwise the tabs as they are. */
export function ensureTab(tabs: Tabs, place: Place): Tabs {
  if (tabs.tabs.length > 0) return tabs
  const { id, lastId } = nextTabId(tabs)
  const tab = freshTab(id, place)
  return { ...tabs, tabs: [tab], active: tab.id, recent: [tab.id], lastId }
}

/**
 * Settings at `section`. The tab that shows Settings is focused and shows
 * the section in place of the one it showed, so moving between sections
 * adds nothing to Back. Otherwise Settings opens as any page does.
 */
export function openSettingsSection(tabs: Tabs, section: SettingsSection, options: OpenOptions = {}): Tabs {
  const at = tabs.tabs.findIndex((tab) => currentPlace(tab).kind === 'settings')
  if (at < 0) return openPlace(tabs, settingsPlace(section), options)
  const tab = tabs.tabs[at]!
  const shown = currentPlace(tab)
  const next = shown.kind === 'settings' && shown.section === section ? tab : { ...tab, history: { ...tab.history, entries: tab.history.entries.with(tab.history.index, settingsPlace(section)) } }
  return activateTab(next === tab ? tabs : { ...tabs, tabs: tabs.tabs.with(at, next) }, tab.id)
}

/** `place` in place of what tab `tabId` shows, with no new history entry: a picture page's ‹ and › step through the gallery, and Back still leaves it. */
export function replaceInTab(tabs: Tabs, tabId: string, place: Place): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === tabId)
  if (at < 0) return tabs
  const tab = tabs.tabs[at]!
  if (samePlace(currentPlace(tab), place)) return tabs
  return { ...tabs, tabs: tabs.tabs.with(at, { ...tab, history: { ...tab.history, entries: tab.history.entries.with(tab.history.index, place) } }) }
}

/** Replace an acknowledged topic throughout history without replacing its mounted view. */
export function acknowledgeTopic(tabs: Tabs, pendingId: string, topicId: string): Tabs {
  const references = (tab: Tab) => tab.history.entries.some(place => place.kind === 'topic' && place.topicId === pendingId)
  const change = (tab: Tab): Tab => {
    if (!references(tab)) return tab
    return { ...tab, history: { ...tab.history, entries: tab.history.entries.map(place =>
      place.kind === 'topic' && place.topicId === pendingId ? { ...place, topicId, viewId: pendingId } : place) } }
  }
  if (!tabs.tabs.some(references) && !tabs.closed.some(entry => references(entry.tab))) return tabs
  const changed = tabs.tabs.map(change)
  const closed = tabs.closed.map(entry => ({ ...entry, tab: change(entry.tab) }))
  return { ...tabs, tabs: changed, closed }
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
  return { ...tabs, tabs: rest, active: neighbour?.id, recent: neighbour === undefined ? recent : touch(recent, neighbour.id), closed }
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

/**
 * ⌘⇧T: the last closed tab, back at its old index (within its pinned or
 * unpinned group) with its history, and active. With `id`, that closed tab
 * instead (the "Draft closed" toast's Undo); nothing when it is not closed.
 */
export function reopenClosedTab(tabs: Tabs, id?: string): Tabs {
  const at = id === undefined ? tabs.closed.length - 1 : tabs.closed.findLastIndex((entry) => entry.tab.id === id)
  const last = tabs.closed[at]
  if (last === undefined) return tabs
  const pinned = pinnedCount(tabs.tabs)
  const index = last.tab.pinned ? Math.min(last.index, pinned) : Math.min(Math.max(last.index, pinned), tabs.tabs.length)
  return { ...tabs, tabs: tabs.tabs.toSpliced(index, 0, last.tab), active: last.tab.id, recent: touch(tabs.recent, last.tab.id), closed: tabs.closed.toSpliced(at, 1) }
}

/** Pins a tab after the pinned ones, or unpins it to the first unpinned place. */
export function setPinned(tabs: Tabs, id: string, pinned: boolean): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  const tab = tabs.tabs[at]
  if (tab === undefined || tab.pinned === pinned) return tabs
  const rest = tabs.tabs.toSpliced(at, 1)
  return { ...tabs, tabs: rest.toSpliced(pinnedCount(rest), 0, { ...tab, pinned }) }
}

/**
 * Moves tab `id` to `index` in the strip, as a drag or ⌃⇧← and ⌃⇧→ do. A
 * pinned tab stays among the pinned ones and an unpinned tab after them, so
 * `index` is clamped to the tab's group. The active tab and history do not change.
 */
export function moveTab(tabs: Tabs, id: string, index: number): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  const tab = tabs.tabs[at]
  if (tab === undefined) return tabs
  const pinned = pinnedCount(tabs.tabs)
  const to = tab.pinned ? Math.min(Math.max(index, 0), pinned - 1) : Math.min(Math.max(index, pinned), tabs.tabs.length - 1)
  if (to === at) return tabs
  return { ...tabs, tabs: tabs.tabs.toSpliced(at, 1).toSpliced(to, 0, tab) }
}

/** Tabs close after this long unseen (Settings › Tidy up, "Close tabs not viewed in"); `never` keeps them. */
export type TabExpiry = 'never' | '1d' | '3d' | '7d'
export const TAB_EXPIRY_DEFAULT: TabExpiry = '1d'
const DAY_MS = 24 * 60 * 60 * 1000
export const tabExpiryMs: Record<TabExpiry, number> = { never: Number.POSITIVE_INFINITY, '1d': DAY_MS, '3d': 3 * DAY_MS, '7d': 7 * DAY_MS }

/** Stamps `ids` as viewed at `now`. */
export function stampViewed(tabs: Tabs, ids: ReadonlyArray<string | undefined>, now: number): Tabs {
  if (!tabs.tabs.some((tab) => ids.includes(tab.id) && tab.lastViewedAt !== now)) return tabs
  return { ...tabs, tabs: tabs.tabs.map((tab) => (ids.includes(tab.id) && tab.lastViewedAt !== now ? { ...tab, lastViewedAt: now } : tab)) }
}

/**
 * Closes the tabs not viewed for `maxAge` ms, onto the reopen stack, so ⌘⇧T
 * brings them back. The active tab and a tab with an unsent draft
 * (`hasDraft`: a Home's, or its topic's) stay. A tab saved before tabs
 * kept a time is stamped `now`, so it gets the full time from here. The
 * timing is coarse: the sweep runs at launch and about hourly.
 */
export function expireTabs(tabs: Tabs, now: number, maxAge: number, hasDraft: (tab: Tab) => boolean = () => false): Tabs {
  const unstamped = tabs.tabs.filter((tab) => tab.lastViewedAt === undefined).map((tab) => tab.id)
  const stamped = stampViewed(tabs, unstamped, now)
  const old = stamped.tabs.filter((tab) => tab.id !== stamped.active && now - tab.lastViewedAt! > maxAge && !hasDraft(tab))
  return closeEach(stamped, old.map((tab) => tab.id))
}

/** Opens or closes the Juno panel in one tab; the other tabs keep theirs. */
export function setJunoPanel(tabs: Tabs, id: string, open: boolean): Tabs {
  const at = tabs.tabs.findIndex((tab) => tab.id === id)
  const tab = tabs.tabs[at]
  if (tab === undefined || (tab.junoPanel === true) === open) return tabs
  const { junoPanel: _open, ...rest } = tab
  return { ...tabs, tabs: tabs.tabs.with(at, open ? { ...rest, junoPanel: true } : rest) }
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
  Schema.Struct({ kind: Schema.Literal('topic'), topicId: Schema.String, viewId: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literals(['home', 'allTopics', 'juno']) }),
  // Saved before New chat became part of Home: a New chat tab reads back as Home, with its draft.
  Schema.Struct({ kind: Schema.Literal('newChat') }),
  Schema.Struct({ kind: Schema.Literal('settings'), section: SettingsSectionSchema }),
  // Saved before Settings was one page: Notifications, Preferences, and Settings › Juno and Connections as Juno pages.
  Schema.Struct({ kind: Schema.Literals(['notifications', 'preferences']) }),
  Schema.Struct({ kind: Schema.Literal('junoPage'), page: JunoPage }),
  Schema.Struct({ kind: Schema.Literal('huddle'), channelId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('gallery'), pictureId: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('search'), sessionId: Schema.String }),
])

/** A saved place as it reads today: the pages that became sections of Settings open there. */
function placeOf(saved: typeof PlaceJson.Type): Place {
  switch (saved.kind) {
    case 'newChat':
      return homePlace
    case 'notifications':
      return settingsPlace('notifications')
    case 'preferences':
      return settingsPlace('general')
    case 'junoPage':
      return saved.page === 'settings' ? settingsPlace('juno') : saved.page === 'connections' ? settingsPlace('connections') : junoPagePlace(saved.page)
    default:
      return saved
  }
}
/**
 * A saved tab, or one saved before history, when a tab's id was its
 * topic's. Tabs saved with the old `stealth` flag still read back; the flag
 * is dropped.
 */
const TabJson = Schema.Union([
  Schema.Struct({ id: Schema.String, pinned: Schema.Boolean, place: PlaceJson, junoPanel: Schema.optionalKey(Schema.Boolean), lastViewedAt: Schema.optionalKey(Schema.Number), homeDraft: Schema.optionalKey(Schema.Unknown), newChat: Schema.optionalKey(Schema.Unknown), search: Schema.optionalKey(Schema.Unknown) }),
  Schema.Struct({ id: Schema.String }),
])
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
      const read = saved.tabs.map((tab): Tab =>
        'place' in tab ? { id: tab.id, pinned: tab.pinned, history: { entries: [placeOf(tab.place)], index: 0 }, ...(tab.junoPanel === true ? { junoPanel: true } : {}), ...(tab.lastViewedAt === undefined ? {} : { lastViewedAt: tab.lastViewedAt }) } : freshTab(tab.id, topicPlace(tab.id)),
      )
      // Old Preferences, Notifications and Settings › Juno tabs all read as Settings, which has one tab.
      const firstSettings = read.find((tab) => currentPlace(tab).kind === 'settings')
      const tabs = read.filter((tab) => tab === firstSettings || currentPlace(tab).kind !== 'settings')
      const kept = new Set(tabs.map((tab) => tab.id))
      const ordered = [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
      const active = saved.active !== null && kept.has(saved.active) ? saved.active : ordered[0]?.id
      const recent = saved.recent.filter((id) => kept.has(id))
      return { tabs: ordered, active, recent: active === undefined ? recent : touch(recent, active), closed: [] }
    },
  })
}

/**
 * A Home tab's draft and destination as a tab saves them, with the thread
 * chosen in it. A New chat saved before Home took its place reads the same
 * way; its thread is dropped. One that no longer reads is dropped, not the
 * tab.
 */
const HomeDraftJson = Schema.Struct({
  draft: Schema.String,
  mentions: Schema.Array(Schema.Struct({ kind: Schema.Literals(['person', 'channel']), id: Schema.String, name: Schema.String })),
  links: Schema.optionalKey(Schema.Array(Schema.Struct({ start: Schema.Int, end: Schema.Int, url: Schema.String }))),
  conversation: Schema.optionalKey(PickConversation),
  thread: Schema.optionalKey(Schema.Struct({ id: Schema.String, rootTs: Schema.String, title: Schema.String, art: Schema.optionalKey(Schema.String) })),
})
const decodeHomeDraft = Schema.decodeUnknownOption(HomeDraftJson)

/** The Home drafts saved with the tabs, by tab id. */
function parseHomeDrafts(value: unknown): ReadonlyMap<string, HomeDraft> {
  const drafts = new Map<string, HomeDraft>()
  Option.map(decodeTabs(value), (saved) => {
    for (const tab of saved.tabs) {
      if (!('place' in tab)) continue
      const json = tab.homeDraft ?? tab.newChat
      if (json === undefined) continue
      Option.map(decodeHomeDraft(json), (draft) =>
        drafts.set(tab.id, { draft: draft.draft, mentions: draft.mentions, links: draft.links ?? [], conversation: draft.conversation, ...(tab.homeDraft === undefined || draft.thread === undefined || draft.conversation === undefined ? {} : { thread: draft.thread }) }),
      )
    }
  })
  return drafts
}

/** The Search sessions saved with the tabs, by session id. One that no longer reads is dropped; the tab opens empty. */
function parseSearchSessions(value: unknown): ReadonlyMap<string, SearchSession> {
  const sessions = new Map<string, SearchSession>()
  Option.map(decodeTabs(value), (saved) => {
    for (const tab of saved.tabs) {
      if (!('place' in tab) || tab.place.kind !== 'search' || tab.search === undefined) continue
      const sessionId = tab.place.sessionId
      Option.map(decodeSearchSession(tab.search), (session) => sessions.set(sessionId, session))
    }
  })
  return sessions
}

/** What `TABS_PREF` holds: each tab with the place it shows, whether its Juno panel is open, a Home tab's draft and destination, and a Search tab's session. */
export function savedTabs(tabs: Tabs, draftOf: (tabId: string) => HomeDraft | undefined = () => undefined, searchOf: (sessionId: string) => SearchSession | undefined = () => undefined): unknown {
  const kept = tabs.tabs.filter((tab) => currentPlace(tab).kind !== 'devLog')
  const ids = new Set(kept.map((tab) => tab.id))
  return {
    tabs: kept.map((tab) => {
      const place = currentPlace(tab)
      const chat = place.kind === 'home' ? draftOf(tab.id) : undefined
      const search = place.kind === 'search' ? searchOf(place.sessionId) : undefined
      return {
        id: tab.id,
        pinned: tab.pinned,
        place,
        ...(tab.lastViewedAt === undefined ? {} : { lastViewedAt: tab.lastViewedAt }),
        ...(tab.junoPanel === true ? { junoPanel: true } : {}),
        ...(chat === undefined || untouched(chat) ? {} : { homeDraft: savedHomeDraft(chat) }),
        ...(search === undefined ? {} : { search }),
      }
    }),
    active: tabs.active !== undefined && ids.has(tabs.active) ? tabs.active : null,
    recent: tabs.recent.filter((id) => ids.has(id)),
  }
}

const savedHomeDraft = (draft: HomeDraft) => ({
  draft: draft.draft,
  mentions: draft.mentions,
  ...((draft.links?.length ?? 0) === 0 ? {} : { links: draft.links }),
  ...(draft.conversation === undefined ? {} : { conversation: draft.conversation }),
  ...(draft.thread === undefined ? {} : { thread: draft.thread }),
})

const savedTabsAtom = liveQuery(prefsGet)({ key: TABS_PREF })

const savedHomeDraftsAtom = Atom.make((get): ReadonlyMap<string, HomeDraft> => {
  const saved = get(savedTabsAtom)
  return AsyncResult.isSuccess(saved) ? parseHomeDrafts(saved.value) : new Map()
})

/** The draft and destination a Home tab was saved with, read back after a restart. */
export const savedHomeDraftAtom = Atom.family((tabId: string) => Atom.make((get) => get(savedHomeDraftsAtom).get(tabId)))

const savedSearchSessionsAtom = Atom.make((get): ReadonlyMap<string, SearchSession> => {
  const saved = get(savedTabsAtom)
  return AsyncResult.isSuccess(saved) ? parseSearchSessions(saved.value) : new Map()
})

/** The session a Search tab was saved with, read back after a restart. */
export const savedSearchSessionAtom = Atom.family((sessionId: string) => Atom.make((get) => get(savedSearchSessionsAtom).get(sessionId)))

/** The tabs as `TABS_PREF` saves them, with each Home tab's draft and destination. */
function saveTabs(registry: Registry, tabs: Tabs): void {
  void runCommand(registry, prefsSet, { key: TABS_PREF, value: savedTabs(tabs, (id) => registry.get(homeDraftAtom(id)), (id) => registry.get(searchSessionAtom(id))) })
}

let chatSave: ReturnType<typeof setTimeout> | undefined

/** Saves the tabs once changes pause: a Home tab's draft, a Search tab's session. */
export function saveTabsSoon(registry: Registry): void {
  clearTimeout(chatSave)
  chatSave = setTimeout(() => {
    chatSave = undefined
    saveTabs(registry, registry.get(tabsAtom))
  }, 300)
}

/** Sets a Home tab's draft and destination, and saves them with the tabs once typing pauses. */
export function setHomeDraft(registry: Registry, tabId: string, draft: HomeDraft): void {
  registry.set(homeDraftAtom(tabId), draft)
  saveTabsSoon(registry)
}

/** Tabs changed in this run of the app, per workspace. Until the first change, the saved ones show. */
const changedTabsAtom = Atom.family((_teamId: string) => Atom.make<Tabs | undefined>(undefined).pipe(Atom.keepAlive))

/** The open tabs of the signed-in workspace. */
export const tabsAtom = Atom.make((get): Tabs => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return noTabs
  const changed = get(changedTabsAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedTabsAtom)
  return AsyncResult.isSuccess(saved) ? ensureTab(parseTabs(saved.value), homePlace) : noTabs
}).pipe(Atom.withEquality((a: Tabs, b: Tabs) => a === b))

/** Changes asked for before the saved tabs had answered (⌘T on the blank launch page), by workspace; applied on top of them once they do. */
const heldChanges = new Map<string, Array<(tabs: Tabs) => Tabs>>()

/** Whether the workspace's tabs are known: changed in this run, or read back from the saved pref. */
const tabsKnown = (registry: Registry, teamId: string): boolean => registry.get(changedTabsAtom(teamId)) !== undefined || AsyncResult.isSuccess(registry.get(savedTabsAtom))

/** Keeps `change` until the saved tabs answer, then applies it. A change applied to no tabs would replace the saved ones instead of joining them. */
function holdChange(registry: Registry, teamId: string, change: (tabs: Tabs) => Tabs): void {
  const held = heldChanges.get(teamId)
  if (held !== undefined) {
    held.push(change)
    return
  }
  heldChanges.set(teamId, [change])
  const off = registry.subscribe(
    savedTabsAtom,
    (saved) => {
      if (!AsyncResult.isSuccess(saved)) return
      off()
      const changes = heldChanges.get(teamId) ?? []
      heldChanges.delete(teamId)
      for (const kept of changes) updateTabs(registry, kept)
    },
    { immediate: false },
  )
}

/**
 * Applies a rule to the tabs and saves the result. A change that leaves no tab leaves one with Home. A change
 * asked for before the saved tabs have answered waits for them (`holdChange`).
 */
export function updateTabs(registry: Registry, change: (tabs: Tabs) => Tabs): Tabs {
  const teamId = registry.get(signedInAtom)?.teamId
  const current = registry.get(tabsAtom)
  if (teamId === undefined) return current
  if (!tabsKnown(registry, teamId)) {
    holdChange(registry, teamId, change)
    return current
  }
  const changed = change(current)
  const ensured = changed === current ? current : ensureTab(changed, homePlace)
  // The tab that became active and the one left are both viewed now; expiry counts from there.
  const next = ensured.active === current.active ? ensured : stampViewed(ensured, [ensured.active, current.active], Date.now())
  if (next === current) return current
  registry.set(changedTabsAtom(teamId), next)
  saveTabs(registry, next)
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
  /** A topic's header, or a huddle's channel's Main: undefined until it arrives (and for a page), null for a topic the store does not know. */
  readonly detail: TopicDetail | null | undefined
  /** A Search tab's title, from its query. */
  readonly title?: string
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
    const result = place.kind === 'topic' ? get(topicAtom(place.topicId)) : place.kind === 'huddle' ? get(topicAtom(mainTopicOf(place.channelId))) : undefined
    const detail = result !== undefined && AsyncResult.isSuccess(result) ? result.value : undefined
    const title = place.kind === 'search' ? get(searchTitleAtom(place.sessionId)) : undefined
    const held = previous.get(tab.id)
    return held !== undefined && held.pinned === tab.pinned && samePlace(held.place, place) && held.detail === detail && held.title === title ? held : { id: tab.id, pinned: tab.pinned, place, detail, ...(title === undefined ? {} : { title }) }
  })
}).pipe(Atom.withEquality(sameStrip))

/** Where an unmounted tab was scrolled: the first row in view and its offset from the top of the list. */
export interface ScrollSnapshot {
  readonly anchorKey: string
  readonly offset: number
}

/**
 * Each topic view's last scroll position, kept while the app runs, so Back
 * and ⌘⇧T return to where it was left. Keyed by `topicView(topicId, tabId)`,
 * so two tabs on one topic keep their own.
 */
export const scrollSnapshotAtom = Atom.family((_view: string) => Atom.make<ScrollSnapshot | undefined>(undefined).pipe(Atom.keepAlive))
