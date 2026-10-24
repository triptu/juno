/**
 * The ways into the Search tab (SPEC 10a, "Opening it"): ⌘⇧F and the
 * sidebar's magnifier, ⌘F in a topic, and `openSearch`, which ⌘K's "All
 * results for …" row calls with its text and filters. Small and eager; the
 * page itself loads as a chunk (`tabKinds.tsx`).
 */
import type { MenuCommand, SearchQuery, TopicDetail } from '@juno/contract'
import { activeTab, currentPlace, newSearchSessionId, registry, requestSearchFocus, startSearchSession, tabsAtom, topicAtom, type SearchSession, type SearchTopicScope } from '@juno/state'
import { showSearch } from '../navigation'
import { closePalette, paletteText } from '../paletteActions'
import { sessionFromQuery, takeChips } from './chips'

export interface OpenSearchOptions {
  /** Words to search for. Finished operators in them become chips. */
  readonly text?: string
  /** A query from ⌘K or the agent: its filters become chips, its words the text. */
  readonly query?: SearchQuery
  /** A new tab after this one, instead of this tab. */
  readonly newTab?: boolean
  /** ⌘F: the topic the search covers. */
  readonly topic?: SearchTopicScope
}

/**
 * Opens a Search tab: in this tab as a new history entry (Back returns to
 * what it showed), or a new tab with `newTab`. With nothing to search for
 * and a Search tab active, its field takes focus instead.
 */
export function openSearch(options: OpenSearchOptions = {}): void {
  const tab = activeTab(registry.get(tabsAtom))
  const place = tab === undefined ? undefined : currentPlace(tab)
  const blank = options.text === undefined && options.query === undefined && options.topic === undefined
  if (blank && options.newTab !== true && place?.kind === 'search') return requestSearchFocus(registry, place.sessionId)
  const id = newSearchSessionId()
  startSearchSession(registry, id, startOf(options))
  requestSearchFocus(registry, id)
  showSearch(id, options.newTab === true ? { newTab: true } : {})
}

function startOf(options: OpenSearchOptions): Partial<SearchSession> {
  const fromQuery = options.query === undefined ? undefined : sessionFromQuery(options.query)
  const typed = options.text === undefined ? undefined : takeChips(options.text.trim(), options.text.trim().length, true)
  return {
    ...fromQuery,
    ...(typed === undefined ? {} : { text: typed.text, chips: [...(fromQuery?.chips ?? []), ...typed.chips] }),
    ...(options.topic === undefined ? {} : { topic: options.topic }),
  }
}

/** ⌘F's scope for a topic: the thread, or a Main's conversation, named as its header names it. */
export function topicScope(detail: TopicDetail): SearchTopicScope {
  const main = detail.kind === 'main'
  return {
    topicId: detail.id,
    channel: detail.channel.id,
    ...(main || detail.rootTs === undefined ? {} : { threadTs: detail.rootTs }),
    title: main ? detail.channel.label : detail.title,
    ...(detail.art === undefined ? {} : { art: detail.art }),
  }
}

/** ⌘F in a topic searches it; anywhere else it is ⌘⇧F. */
function searchHere(): void {
  const tab = activeTab(registry.get(tabsAtom))
  const place = tab === undefined ? undefined : currentPlace(tab)
  if (place?.kind !== 'topic') return openSearch()
  const result = registry.get(topicAtom(place.viewId ?? place.topicId))
  if (result._tag !== 'Success' || result.value === null) return openSearch()
  openSearch({ topic: topicScope(result.value) })
}

/**
 * The app menu's Search items. Subscribed by the workspace. The menu takes ⌘⇧F before the palette sees the key,
 * so an open palette closes here and its text goes to the Search tab.
 */
export function runSearchCommand(command: MenuCommand): void {
  const typed = paletteText()
  if (typed !== undefined && (command === 'search.open' || command === 'search.topic')) {
    closePalette(false)
    return openSearch(typed.trim() === '' ? {} : { text: typed })
  }
  if (command === 'search.open') openSearch()
  else if (command === 'search.topic') searchHere()
}
