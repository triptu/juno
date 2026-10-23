/** The sidebar list: quick filters, scope, sections and order (spec section 5). */
import { isDm } from './channel'
import { compareTs, type ChannelId } from './ids'
import { isUnread, sidebarPlacement } from './status'
import { type RuleContext, type Topic } from './topic'

export type KindFilter = 'all' | 'channels' | 'dms'

export interface SidebarFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  /** Narrowed to one channel from Browse or ⌘K. */
  readonly scope?: ChannelId
}

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

/**
 * Numeric order of two timestamps. Two well-formed ts of the same length
 * have the dot in the same place, so their text order is their numeric
 * order, which spares the parse on the sidebar's hot path.
 */
function compareActivity(a: string, b: string): number {
  if (a.length === b.length) return a < b ? -1 : a > b ? 1 : 0
  return compareTs(a, b)
}

/** Latest activity first; ties break on id so the order is stable. */
export function byLatestActivity(a: Topic, b: Topic): number {
  const c = compareActivity(b.activity.lastActivityTs, a.activity.lastActivityTs)
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

