/**
 * Status and visibility (architecture 4.4, spec section 5).
 *
 * ignored channel → ignored; unsubscribed → unsubscribed; resolved with no
 * later activity → resolved; no activity within the quiet window and not
 * pinned and nothing unread → quiet; else open.
 */
import { compareTs, tsToMillis } from './ids'
import { quietDaysOf, type RuleContext, type Topic } from './topic'

export type TopicStatus = 'open' | 'quiet' | 'resolved' | 'unsubscribed' | 'ignored'

const DAY = 24 * 60 * 60 * 1000

export function isPinned(topic: Topic): boolean {
  return topic.overlay.pinnedAt !== undefined
}

export function isUnread(topic: Topic): boolean {
  return topic.activity.unreadCount > 0
}

/** True when new activity arrived after the last resolve. */
export function hasActivityAfterResolve(topic: Topic): boolean {
  const { resolvedAt, resolvedActivityTs } = topic.overlay
  if (resolvedAt === undefined) return false
  if (resolvedActivityTs === undefined) return false
  return compareTs(topic.activity.lastActivityTs, resolvedActivityTs) > 0
}

export function isResolved(topic: Topic): boolean {
  return topic.overlay.resolvedAt !== undefined && !hasActivityAfterResolve(topic)
}

/** Whether the quiet window has passed since the last activity. Pins and unread do not count here. */
export function isOlderThanQuietWindow(topic: Topic, ctx: RuleContext): boolean {
  return ctx.now - tsToMillis(topic.activity.lastActivityTs) > quietDaysOf(ctx) * DAY
}

export function topicStatus(topic: Topic, ctx: RuleContext): TopicStatus {
  if (topic.channel.ignored) return 'ignored'
  if (topic.overlay.unsubscribedAt !== undefined) return 'unsubscribed'
  if (isResolved(topic)) return 'resolved'
  if (isOlderThanQuietWindow(topic, ctx) && !isPinned(topic) && !isUnread(topic)) return 'quiet'
  return 'open'
}

/**
 * The "Reopened" tag: shown after activity follows a resolve, until the
 * topic is marked read or resolved again. The engine clears `reopenedAt`
 * on mark-read and on resolve; before it does, activity after the resolve
 * counts too.
 */
export function showsReopenedTag(topic: Topic): boolean {
  if (isResolved(topic)) return false
  return topic.overlay.reopenedAt !== undefined || hasActivityAfterResolve(topic)
}

export type SidebarPlacement = 'pinned' | 'recent' | 'hidden'

/**
 * Where a topic sits in the sidebar. Open topics are in Recent; every pinned
 * topic is in Pinned, even when resolved or quiet; ignored channels never show.
 */
export function sidebarPlacement(topic: Topic, ctx: RuleContext): SidebarPlacement {
  const status = topicStatus(topic, ctx)
  if (status === 'ignored') return 'hidden'
  if (isPinned(topic)) return 'pinned'
  return status === 'open' ? 'recent' : 'hidden'
}

/** A pinned resolved row is dimmed with a check and has no hover Resolve. */
export function showsResolvedCheck(topic: Topic, ctx: RuleContext): boolean {
  return sidebarPlacement(topic, ctx) === 'pinned' && isResolved(topic)
}

export function canResolveOnHover(topic: Topic): boolean {
  return !isResolved(topic)
}

export type RowTag = 'main' | 'reopened' | 'unsubscribed'

/** Tags after the title, in display order. */
export function rowTags(topic: Topic): ReadonlyArray<RowTag> {
  const tags: RowTag[] = []
  if (topic.kind === 'main') tags.push('main')
  if (showsReopenedTag(topic)) tags.push('reopened')
  if (topic.overlay.unsubscribedAt !== undefined) tags.push('unsubscribed')
  return tags
}

/** Whether a topic appears on All topics: everything except ignored channels. */
export function showsInAllTopics(topic: Topic): boolean {
  return !topic.channel.ignored
}

export type AllTopicsStatus = Exclude<TopicStatus, 'ignored'>

/** The status chip on All topics. Only call for topics that pass `showsInAllTopics`. */
export function allTopicsStatus(topic: Topic, ctx: RuleContext): AllTopicsStatus {
  const status = topicStatus(topic, ctx)
  return status === 'ignored' ? 'open' : status
}

export function statusLabel(status: AllTopicsStatus): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'resolved':
      return 'Resolved'
    case 'quiet':
      return 'Quiet'
    case 'unsubscribed':
      return 'Unsubscribed'
  }
}
