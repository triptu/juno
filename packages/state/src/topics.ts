/**
 * Atoms for the topics feature (architecture 7). `topicListAtom(filter)` is
 * the sidebar window; a container subscribes to `orderAtom(list)` and each
 * row to `rowAtom(list)(id)`. Equal filters share one atom.
 *
 * `subscribeTopicCommand` and `unsubscribeTopicCommand` take `{ id }` and
 * resolve with `{ undo? }` (ADR 0010); the undo stack replays an undo by
 * writing the atom named by its `_tag` (`commandAtomFor`).
 */
import { topicsCounts, topicsList, topicsSubscribe, topicsUnsubscribe, type KindFilter, type UndoCommand } from '@juno/contract'
import { command, liveQuery } from './atoms'

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

/** Follows a thread in Slack and shows it in the sidebar, or un-hides a Main. */
export const subscribeTopicCommand = command(topicsSubscribe)

/** Unfollows a thread in Slack, or hides a Main. The result carries the undo. */
export const unsubscribeTopicCommand = command(topicsUnsubscribe)

/** The command atom an undo replays, by the undo's tag. */
export function commandAtomFor(undo: UndoCommand) {
  switch (undo._tag) {
    case 'topics.subscribe':
      return subscribeTopicCommand
    case 'topics.unsubscribe':
      return unsubscribeTopicCommand
  }
}
