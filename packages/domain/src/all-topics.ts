/** The All topics page: status chips with counts, filters, sort and text filter (spec section 11). */
import type { ChannelId } from './ids'
import { byLatestActivity, matchesKind, type KindFilter } from './sidebar'
import { allTopicsStatus, showsInAllTopics, type AllTopicsStatus } from './status'
import { resolveTitle } from './title'
import type { RuleContext, Topic } from './topic'

export type StatusChip = 'all' | AllTopicsStatus
export type AllTopicsSort = 'recent' | 'oldest' | 'messages'

export interface AllTopicsFilter {
  readonly status: StatusChip
  readonly kind: KindFilter
  readonly scope?: ChannelId
  readonly sort: AllTopicsSort
  /** Matched against title and preview text, case-insensitive. */
  readonly query?: string
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
  /** Counts after the kind, scope and text filters, before the status chip. */
  readonly counts: AllTopicsCounts
}

function matchesQuery(topic: Topic, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  if (resolveTitle(topic).text.toLowerCase().includes(q)) return true
  const preview = topic.preview
  return preview !== undefined && `${preview.sender}: ${preview.text}`.toLowerCase().includes(q)
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
    if (filter.query !== undefined && !matchesQuery(topic, filter.query)) continue
    const status = allTopicsStatus(topic, ctx)
    counts.all++
    counts[status]++
    if (filter.status === 'all' || filter.status === status) rows.push({ topic, status })
  }
  return { rows: sortRows(rows, filter.sort), counts }
}
