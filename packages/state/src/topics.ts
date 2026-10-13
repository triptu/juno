/**
 * Atoms for the topics feature (architecture 7). `topicListAtom(filter)` is
 * the sidebar window; a container subscribes to `orderAtom(list)` and each
 * row to `rowAtom(list)(id)`. Equal filters share one atom.
 */
import { topicsCounts, topicsList, type KindFilter } from '@juno/contract'
import { liveQuery } from './atoms'

export interface TopicListFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
}

export const defaultTopicListFilter: TopicListFilter = { kind: 'all', unreadOnly: false }

/** The sidebar holds at most this many rows (performance 3.2). */
export const SIDEBAR_WINDOW = 300

const listFamily = liveQuery(topicsList)
const countsFamily = liveQuery(topicsCounts)

/** The sidebar list for a filter: pinned first, then recent, as `TopicRow`s. */
export const topicListAtom = (filter: TopicListFilter = defaultTopicListFilter) =>
  listFamily({
    kind: filter.kind,
    unreadOnly: filter.unreadOnly,
    ...(filter.scope === undefined ? {} : { scope: filter.scope }),
    range: { limit: SIDEBAR_WINDOW },
  })

/** Unread topics per group, for the dots after the Channels and DMs filters. */
export const topicCountsAtom = (scope?: string) => countsFamily(scope === undefined ? {} : { scope })
