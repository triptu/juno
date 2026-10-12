/** The sidebar list: quick filters, scope, sections and order (spec section 5). */
import { isDm } from './channel'
import { compareTs, type ChannelId } from './ids'
import { isUnread, sidebarPlacement } from './status'
import { quietDaysOf, type RuleContext, type Topic } from './topic'

export type KindFilter = 'all' | 'channels' | 'dms'

export interface SidebarFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  /** Narrowed to one channel from Browse or ⌘K. */
  readonly scope?: ChannelId
}

export const defaultSidebarFilter: SidebarFilter = { kind: 'all', unreadOnly: false }

export interface SidebarList {
  readonly pinned: ReadonlyArray<Topic>
  readonly recent: ReadonlyArray<Topic>
}

export function matchesKind(topic: Topic, kind: KindFilter): boolean {
  if (kind === 'all') return true
  return kind === 'dms' ? isDm(topic.channel.kind) : !isDm(topic.channel.kind)
}

export function matchesSidebarFilter(topic: Topic, filter: SidebarFilter): boolean {
  if (!matchesKind(topic, filter.kind)) return false
  if (filter.scope !== undefined && topic.channel.id !== filter.scope) return false
  if (filter.unreadOnly && !isUnread(topic)) return false
  return true
}

/** Latest activity first; ties break on id so the order is stable. */
export function byLatestActivity(a: Topic, b: Topic): number {
  const c = compareTs(b.activity.lastActivityTs, a.activity.lastActivityTs)
  return c !== 0 ? c : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The rows the sidebar shows, split into Pinned and Recent. */
export function sidebarList(topics: ReadonlyArray<Topic>, filter: SidebarFilter, ctx: RuleContext): SidebarList {
  const pinned: Topic[] = []
  const recent: Topic[] = []
  for (const topic of topics) {
    if (!matchesSidebarFilter(topic, filter)) continue
    const placement = sidebarPlacement(topic, ctx)
    if (placement === 'pinned') pinned.push(topic)
    else if (placement === 'recent') recent.push(topic)
  }
  pinned.sort(byLatestActivity)
  recent.sort(byLatestActivity)
  return { pinned, recent }
}

export interface FilterDots {
  readonly channels: boolean
  readonly dms: boolean
}

/**
 * The small dot after "Channels" or "DMs": that group has unread topics the
 * sidebar would show, and the group is not the one selected.
 */
export function filterDots(topics: ReadonlyArray<Topic>, filter: SidebarFilter, ctx: RuleContext): FilterDots {
  let channels = false
  let dms = false
  for (const topic of topics) {
    if (!isUnread(topic)) continue
    if (sidebarPlacement(topic, ctx) === 'hidden') continue
    if (filter.scope !== undefined && topic.channel.id !== filter.scope) continue
    if (isDm(topic.channel.kind)) dms = true
    else channels = true
  }
  return { channels: channels && filter.kind !== 'channels', dms: dms && filter.kind !== 'dms' }
}

export type SidebarEmptyState = {
  readonly title: string
  readonly body: string
  readonly action: 'clear-filters' | 'view-all-topics'
  readonly actionLabel: string
}

/** Copy for the empty list (inventory 2.6). `undefined` when the list is not empty. */
export function sidebarEmptyState(list: SidebarList, filter: SidebarFilter, ctx: RuleContext): SidebarEmptyState | undefined {
  if (list.pinned.length > 0 || list.recent.length > 0) return undefined
  const hiding = 'Your filters are hiding everything. Older and resolved topics are in All topics.'
  if (filter.unreadOnly) return { title: 'No unread topics', body: hiding, action: 'clear-filters', actionLabel: 'Clear filters' }
  if (filter.kind !== 'all' || filter.scope !== undefined) {
    return { title: 'No recent topics here', body: hiding, action: 'clear-filters', actionLabel: 'Clear filters' }
  }
  const days = quietDaysOf(ctx)
  return {
    title: 'No recent topics here',
    body: `Topics with activity in the last ${days} days show up here.`,
    action: 'view-all-topics',
    actionLabel: 'View all topics',
  }
}
