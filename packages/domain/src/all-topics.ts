/**
 * The All topics page (spec section 11): status chips with counts, the kind
 * and place filters and the sort, as a pure rule. The engine runs the same
 * rule in SQL over the whole index (`engine/src/topics/allTopics.ts`); an
 * engine test holds the two together. The text filter is not here: it is a
 * full-text search the engine runs over titles and messages.
 */
import type { ChannelId } from './ids'
import { byLatestActivity, matchesKind, type KindFilter } from './sidebar'
import { allTopicsStatus, showsInAllTopics, type AllTopicsStatus } from './status'
import type { RuleContext, Topic } from './topic'

export type StatusChip = 'all' | AllTopicsStatus
export type AllTopicsSort = 'recent' | 'oldest' | 'messages'

export interface AllTopicsFilter {
  readonly status: StatusChip
  readonly kind: KindFilter
  readonly scope?: ChannelId
  readonly sort: AllTopicsSort
}

export const defaultAllTopicsFilter: AllTopicsFilter = { status: 'all', kind: 'all', sort: 'recent' }

export interface AllTopicsRow {
  readonly topic: Topic
  readonly status: AllTopicsStatus
}

export interface AllTopicsCounts {
  readonly all: number
  readonly open: number
  readonly resolved: number
  readonly quiet: number
  readonly unsubscribed: number
}

export interface AllTopicsList {
  readonly rows: ReadonlyArray<AllTopicsRow>
  /** Counts after the kind and scope filters, before the status chip. */
  readonly counts: AllTopicsCounts
}

export function sortRows(rows: ReadonlyArray<AllTopicsRow>, sort: AllTopicsSort): AllTopicsRow[] {
  switch (sort) {
    case 'recent':
      return rows.toSorted((a, b) => byLatestActivity(a.topic, b.topic))
    case 'oldest':
      return rows.toSorted((a, b) => byLatestActivity(b.topic, a.topic))
    case 'messages':
      return rows.toSorted((a, b) => b.topic.activity.messageCount - a.topic.activity.messageCount || byLatestActivity(a.topic, b.topic))
  }
}

export function allTopicsList(topics: ReadonlyArray<Topic>, filter: AllTopicsFilter, ctx: RuleContext): AllTopicsList {
  const counts = { all: 0, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 }
  const rows: AllTopicsRow[] = []
  for (const topic of topics) {
    if (!showsInAllTopics(topic)) continue
    if (!matchesKind(topic, filter.kind)) continue
    if (filter.scope !== undefined && topic.channel.id !== filter.scope) continue
    const status = allTopicsStatus(topic, ctx)
    counts.all++
    counts[status]++
    if (filter.status === 'all' || filter.status === status) rows.push({ topic, status })
  }
  return { rows: sortRows(rows, filter.sort), counts }
}
