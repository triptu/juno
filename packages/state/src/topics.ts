/**
 * Atoms for the topics feature (architecture 7). `topicListAtom(filter)` is
 * one filter's sidebar window; the sidebar reads it through
 * `sidebarListAtom` (`sidebar.ts`), which holds the shown window across a
 * filter change. Equal filters share one atom.
 *
 * The subscribe and unsubscribe commands are run per row with
 * `runCommand(registry, topicsSubscribe, { id })`: a shared command atom
 * runs one call at a time, so a second write would interrupt the first.
 */
import { SIDEBAR_WINDOW, topicsCounts, topicsList, type KindFilter } from '@juno/contract'
import { liveQuery } from './atoms'

export interface TopicListFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
}

export const defaultTopicListFilter: TopicListFilter = { kind: 'all', unreadOnly: false }

const listFamily = liveQuery(topicsList)
const countsFamily = liveQuery(topicsCounts)

/** The sidebar list for a filter: pinned first, then recent, as `TopicRow`s, at most `SIDEBAR_WINDOW` of them. */
export const topicListAtom = (filter: TopicListFilter = defaultTopicListFilter) =>
  listFamily({
    kind: filter.kind,
    unreadOnly: filter.unreadOnly,
    ...(filter.scope === undefined ? {} : { scope: filter.scope }),
    range: { limit: SIDEBAR_WINDOW },
  })

/** Unread topics per group, for the dots after the Channels and DMs filters. */
export const topicCountsAtom = (scope?: string) => countsFamily(scope === undefined ? {} : { scope })
