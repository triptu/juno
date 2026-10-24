/**
 * The Search tab (SPEC 10a, `docs/design/search/README.md`): renderer state
 * the engine does not keep.
 *
 * - `searchSessionAtom(id)`: one Search tab's field (chips and text), topic
 *   scope, sort, selection and scroll. It lives outside the mounted page, so
 *   Back, ⌘⇧T and a restart bring it back; it is saved with the tabs
 *   (`savedTabs`). Change it with `updateSearchSession`.
 * - `searchPrefsAtom`: Apps hidden, Automated hidden, Group by thread and the
 *   results column's width, one for every Search tab, saved to the workspace
 *   preference `SEARCH_PREF`.
 * - `searchResultsAtom(id)`: the engine's `search.session` snapshot for the
 *   session's query. A new query is a new generation; until its first
 *   snapshot arrives the last one shows, so the list never flashes empty.
 * - `recentSearchesAtom`: the last 10 searches with their chips, saved to
 *   `SEARCH_RECENT_PREF`.
 */
import { Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { MESSAGE_WINDOW_BEFORE, MESSAGE_WINDOW_DEFAULT, parseSearchQuery, Person, prefsGet, prefsSet, SEARCH_COLUMN_WIDTH, searchMore, searchSession, type PickConversation, type SearchQuery, type SearchSnapshot } from '@juno/contract'
import { liveQuery, prefetch, runCommand } from './atoms'
import { paletteConversationsAtom } from './palette'
import { bottomWindow, messagesAtom, topicAtom, type MessageWindowSpec } from './messages'
import type { Registry } from './client'
import { privacyAtom } from './shell'
import { signedInAtom } from './session'
import { savedSearchSessionAtom, saveTabsSoon } from './tabs'

/** A filter shown as a chip in the field. Its `token` is what the parser reads. */
export const SearchChip = Schema.Struct({
  op: Schema.Literals(['from', 'in', 'date', 'has', 'is']),
  /** "from:U0MAYA", "-in:C0ENG", "has:link", "after:2026-10-11 before:2026-10-19". */
  token: Schema.String,
  /** What follows the operator on the chip: "Maya Chen", "link", "Last week". */
  label: Schema.String,
  /** A from: chip's person, for the photo. */
  person: Schema.optionalKey(Person),
  /** An in: chip's place, for the icon. */
  place: Schema.optionalKey(Schema.Struct({ kind: Schema.Literals(['public', 'private', 'im', 'mpim']) })),
})
export type SearchChip = typeof SearchChip.Type

/** ⌘F in a topic: the search covers that thread, or a Main's conversation. Shown as an "in:" chip with the topic's title. */
export const SearchTopicScope = Schema.Struct({
  topicId: Schema.String,
  channel: Schema.String,
  threadTs: Schema.optionalKey(Schema.String),
  title: Schema.String,
  art: Schema.optionalKey(Schema.String),
})
export type SearchTopicScope = typeof SearchTopicScope.Type

/** The chosen result: the row, and the topic and message the reader shows. */
export const SearchSelection = Schema.Struct({ id: Schema.String, topicId: Schema.String, ts: Schema.optionalKey(Schema.String), stored: Schema.optionalKey(Schema.Boolean) })
export type SearchSelection = typeof SearchSelection.Type

export const SearchSession = Schema.Struct({
  text: Schema.String,
  chips: Schema.Array(SearchChip),
  topic: Schema.optionalKey(SearchTopicScope),
  sort: Schema.Literals(['newest', 'oldest']),
  selected: Schema.optionalKey(SearchSelection),
  /** The results window's first row, and the list's scroll offset, to come back to. */
  offset: Schema.optionalKey(Schema.Int),
  scrollTop: Schema.optionalKey(Schema.Number),
  /** Bumped by Enter in the field: Slack is asked at once. */
  commit: Schema.Int,
})
export type SearchSession = typeof SearchSession.Type

export const emptySearchSession: SearchSession = { text: '', chips: [], sort: 'newest', commit: 0 }
export const decodeSearchSession = Schema.decodeUnknownOption(SearchSession)

/** Nothing to search for: the empty field shows recent searches. A topic scope alone is still empty. */
export const searchIsEmpty = (session: SearchSession): boolean => session.text.trim() === '' && session.chips.length === 0

/** A new Search tab's id. */
export const newSearchSessionId = (): string => `search-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Changed in this run of the app. Until the first change, the one saved with the tabs shows. */
const changedSessionAtom = Atom.family((_id: string) => Atom.make<SearchSession | undefined>(undefined).pipe(Atom.keepAlive))

export const searchSessionAtom = Atom.family((id: string) =>
  Atom.make((get): SearchSession => get(changedSessionAtom(id)) ?? get(savedSearchSessionAtom(id)) ?? emptySearchSession).pipe(Atom.keepAlive),
)

/** Changes a session and saves it with the tabs once changes pause. */
export function updateSearchSession(registry: Registry, id: string, change: (session: SearchSession) => SearchSession): SearchSession {
  const current = registry.get(searchSessionAtom(id))
  const next = change(current)
  if (next === current) return current
  registry.set(changedSessionAtom(id), next)
  saveTabsSoon(registry)
  return next
}

/** Starts a session with what it opens on (⌘F's scope, ⌘K's text and chips). */
export function startSearchSession(registry: Registry, id: string, start: Partial<SearchSession>): void {
  registry.set(changedSessionAtom(id), { ...emptySearchSession, ...start })
}

/** Bumped to ask a Search tab's field for focus (⌘⇧F, the magnifier), so a request reaches a page that mounts after it. */
export const searchFocusAtom = Atom.family((_id: string) => Atom.make(0).pipe(Atom.keepAlive))

export function requestSearchFocus(registry: Registry, id: string): void {
  registry.set(searchFocusAtom(id), registry.get(searchFocusAtom(id)) + 1)
}

/** The tab's title: the query's words, its chips when it has none, or "Search". Privacy mode shows "Search". */
export const searchTitleAtom = Atom.family((id: string) =>
  Atom.make((get): string => {
    if (get(privacyAtom)) return 'Search'
    const session = get(searchSessionAtom(id))
    return session.text.trim() || session.chips.map((chip) => chip.label).join(' ') || 'Search'
  }),
)

// Preferences

export const SEARCH_PREF = 'search'

export interface SearchPrefs {
  readonly hideApps: boolean
  readonly hideAutomated: boolean
  readonly groupByThread: boolean
  readonly column: number
}

const defaultPrefs: SearchPrefs = { hideApps: true, hideAutomated: true, groupByThread: false, column: SEARCH_COLUMN_WIDTH.default }
const PrefsJson = Schema.Struct({
  hideApps: Schema.optionalKey(Schema.Boolean),
  hideAutomated: Schema.optionalKey(Schema.Boolean),
  groupByThread: Schema.optionalKey(Schema.Boolean),
  column: Schema.optionalKey(Schema.Number),
})
const decodePrefs = Schema.decodeUnknownOption(PrefsJson)
const validColumn = (width: number) => Number.isInteger(width) && width >= SEARCH_COLUMN_WIDTH.min && width <= SEARCH_COLUMN_WIDTH.max

const savedPrefsAtom = liveQuery(prefsGet)({ key: SEARCH_PREF })
const changedPrefsAtom = Atom.family((_teamId: string) => Atom.make<SearchPrefs | undefined>(undefined).pipe(Atom.keepAlive))

export const searchPrefsAtom = Atom.make((get): SearchPrefs => {
  const teamId = get(signedInAtom)?.teamId
  const changed = teamId === undefined ? undefined : get(changedPrefsAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedPrefsAtom)
  if (!AsyncResult.isSuccess(saved)) return defaultPrefs
  return Option.match(decodePrefs(saved.value), {
    onNone: () => defaultPrefs,
    onSome: (json) => ({ ...defaultPrefs, ...json, column: json.column !== undefined && validColumn(json.column) ? json.column : defaultPrefs.column }),
  })
}).pipe(Atom.withEquality((a: SearchPrefs, b: SearchPrefs) => a.hideApps === b.hideApps && a.hideAutomated === b.hideAutomated && a.groupByThread === b.groupByThread && a.column === b.column))

export function setSearchPrefs(registry: Registry, change: Partial<SearchPrefs>): void {
  const teamId = registry.get(signedInAtom)?.teamId
  if (teamId === undefined) return
  const current = registry.get(searchPrefsAtom)
  const next = { ...current, ...change }
  if (!validColumn(next.column)) return
  registry.set(changedPrefsAtom(teamId), next)
  void runCommand(registry, prefsSet, { key: SEARCH_PREF, value: next })
}

// The query and its results

/** The session as one `SearchQuery`: the chips' tokens, then the typed text, with the toggles, sort and topic scope. */
export function searchQueryOf(session: SearchSession, prefs: SearchPrefs): SearchQuery {
  const raw = [...session.chips.map((chip) => chip.token), session.text.trim()].filter((part) => part !== '').join(' ')
  const topic = session.topic === undefined ? undefined : { channel: session.topic.channel, ...(session.topic.threadTs === undefined ? {} : { threadTs: session.topic.threadTs }) }
  return parseSearchQuery(raw, { scope: { hideApps: prefs.hideApps, hideAutomated: prefs.hideAutomated, sort: session.sort, groupByThread: prefs.groupByThread, ...(topic === undefined ? {} : { topic }) } })
}

/** Generations only grow, across sessions and restarts, so the engine never takes a new query for an old one. */
let generation = Date.now()

interface Run {
  readonly key: string
  readonly text: string
  readonly commit: number
  readonly payload: { readonly sessionId: string; readonly generation: number; readonly query: SearchQuery; readonly immediate?: boolean }
}

/**
 * What the session asks the engine for. The same query keeps its generation, so coming back to the tab
 * within the idle time finds its snapshot still there. Typing waits for the engine's pause before Slack;
 * anything else (a chip, a toggle, the sort, Enter, a restored tab) asks Slack at once.
 */
const runAtom = Atom.family((id: string) =>
  Atom.make((get): Run | undefined => {
    const session = get(searchSessionAtom(id))
    if (searchIsEmpty(session)) return undefined
    const query = searchQueryOf(session, get(searchPrefsAtom))
    const key = JSON.stringify(query)
    const previous = Option.getOrUndefined(get.self<Run | undefined>())
    if (previous !== undefined && previous.key === key && previous.commit === session.commit) return previous
    const typing = previous !== undefined && previous.text !== session.text && previous.commit === session.commit
    return { key, text: session.text, commit: session.commit, payload: { sessionId: id, generation: ++generation, query, ...(typing ? {} : { immediate: true }) } }
  }).pipe(Atom.keepAlive),
)

const sessionFamily = liveQuery(searchSession)

export interface SearchResults {
  readonly snapshot: SearchSnapshot
  /** The snapshot answers the field as it is now, not a query typed over since. */
  readonly current: boolean
}

/** The session's snapshot, or the last one while the next query's first arrives. Undefined for an empty field. */
export const searchResultsAtom = Atom.family((id: string) =>
  Atom.make((get): SearchResults | undefined => {
    const run = get(runAtom(id))
    if (run === undefined) return undefined
    const result = get(sessionFamily(run.payload))
    if (AsyncResult.isSuccess(result)) return { snapshot: result.value, current: true }
    const previous = Option.getOrUndefined(get.self<SearchResults | undefined>())
    return previous === undefined ? undefined : previous.current ? { ...previous, current: false } : previous
  }),
)

/**
 * The next page, or Try again after Slack did not answer. `offset` moves the 100-row window the engine
 * sends. False when the engine is still busy with the last request or the query has changed.
 */
export async function loadMoreSearch(registry: Registry, id: string, offset?: number): Promise<boolean> {
  const run = registry.get(runAtom(id))
  if (run === undefined) return false
  const exit = await runCommand(registry, searchMore, { sessionId: id, generation: run.payload.generation, ...(offset === undefined ? {} : { offset }) })
  return exit._tag === 'Success' && exit.value
}

// The from: and in: picker

const noPicks = Atom.make<ReadonlyArray<PickConversation> | undefined>(undefined)
const picksFamily = Atom.family((query: string) =>
  Atom.make((get): ReadonlyArray<PickConversation> | undefined => {
    const result = get(paletteConversationsAtom(query))
    return AsyncResult.isSuccess(result) ? result.value : undefined
  }),
)

/** The picker's conversations for the value typed after from: or in:, ranked as ⌘K's Conversations tab. Nothing while it is closed. */
export const searchPicksAtom = (query: string | undefined) => (query === undefined ? noPicks : picksFamily(query.trim()))

// The reader

/** The window the reader shows a match in: the messages around it, so it opens at the match in one frame. */
export const readerWindow = (ts: string | undefined): MessageWindowSpec => (ts === undefined ? bottomWindow : { anchor: ts, before: MESSAGE_WINDOW_BEFORE, limit: MESSAGE_WINDOW_DEFAULT })

/** Warms a result the arrows may reach next: its header and the window the reader would show (performance 4.2). */
export function prefetchSearchResult(registry: Registry, topicId: string, ts: string | undefined): void {
  prefetch(registry, [messagesAtom(topicId, readerWindow(ts)), topicAtom(topicId)])
}

// Recent searches

export const SEARCH_RECENT_PREF = 'searchRecent'
export const SEARCH_RECENT_MAX = 10

export const RecentSearch = Schema.Struct({ text: Schema.String, chips: Schema.Array(SearchChip) })
export type RecentSearch = typeof RecentSearch.Type
const decodeRecent = Schema.decodeUnknownOption(Schema.Array(RecentSearch))

const savedRecentAtom = liveQuery(prefsGet)({ key: SEARCH_RECENT_PREF })
const changedRecentAtom = Atom.family((_teamId: string) => Atom.make<ReadonlyArray<RecentSearch> | undefined>(undefined).pipe(Atom.keepAlive))

export const recentSearchesAtom = Atom.make((get): ReadonlyArray<RecentSearch> => {
  const teamId = get(signedInAtom)?.teamId
  const changed = teamId === undefined ? undefined : get(changedRecentAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedRecentAtom)
  return AsyncResult.isSuccess(saved) ? Option.getOrElse(decodeRecent(saved.value), () => []) : []
})

const recentKey = (recent: RecentSearch) => [...recent.chips.map((chip) => chip.token), recent.text.trim()].join(' ')

function setRecent(registry: Registry, recent: ReadonlyArray<RecentSearch>): void {
  const teamId = registry.get(signedInAtom)?.teamId
  if (teamId === undefined) return
  registry.set(changedRecentAtom(teamId), recent)
  void runCommand(registry, prefsSet, { key: SEARCH_RECENT_PREF, value: recent })
}

/** Puts the session's search first among the recent ones, once it was searched for on purpose (Enter, or a result opened or read). */
export function rememberSearch(registry: Registry, id: string): void {
  const session = registry.get(searchSessionAtom(id))
  if (searchIsEmpty(session)) return
  const entry: RecentSearch = { text: session.text.trim(), chips: session.chips }
  const key = recentKey(entry)
  const recent = registry.get(recentSearchesAtom)
  if (recentKey(recent[0] ?? { text: '', chips: [] }) === key) return
  setRecent(registry, [entry, ...recent.filter((other) => recentKey(other) !== key)].slice(0, SEARCH_RECENT_MAX))
}

export function forgetSearch(registry: Registry, index: number): void {
  const recent = registry.get(recentSearchesAtom)
  if (index >= 0 && index < recent.length) setRecent(registry, recent.toSpliced(index, 1))
}
