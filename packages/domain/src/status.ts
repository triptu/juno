/**
 * Status and visibility (architecture 4.4, spec section 5 "What shows up").
 *
 * Status: ignored channel → ignored; unsubscribed → unsubscribed; resolved
 * with no later activity → resolved; no activity within the quiet window
 * and not pinned and nothing unread → quiet; else open. For Main, "activity"
 * is anything in the channel, including replies in its threads.
 *
 * The sidebar shows open topics, but only threads the user follows in Slack
 * or threads with an unread mention of the user; other threads stay topics
 * (All topics, the channel's Main) without a row. Every pinned topic is in
 * Pinned; only an ignored channel hides a pinned topic.
 */
import { Schema } from 'effect'
import { compareTs, maxTs, tsToMillis } from './ids'
import { quietDaysOf, type RuleContext, type Topic } from './topic'

export type TopicStatus = 'open' | 'quiet' | 'resolved' | 'unsubscribed' | 'ignored'

/** The status a row or an All topics chip can show: every status but `ignored`, which hides the topic. */
export const AllTopicsStatus = Schema.Literals(['open', 'quiet', 'resolved', 'unsubscribed'])
export type AllTopicsStatus = typeof AllTopicsStatus.Type

const DAY = 24 * 60 * 60 * 1000

export function isPinned(topic: Topic): boolean {
  return topic.overlay.pinnedAt !== undefined
}

export function isUnread(topic: Topic): boolean {
  return topic.activity.unreadCount > 0
}

/** An unread message that mentions the user directly. */
export function hasUnreadMention(topic: Topic): boolean {
  return isUnread(topic) && topic.activity.mentionsMe
}

/** The user follows the thread in Slack ("Get notified about new replies"). Main is never followed. */
export function isFollowed(topic: Topic): boolean {
  return topic.kind === 'thread' && topic.slackSubscribed === true
}

/**
 * The user unfollowed the thread in Slack. A thread Slack has said nothing
 * about is not unsubscribed, only not followed. Main is never unsubscribed.
 */
export function isUnsubscribed(topic: Topic): boolean {
  return topic.kind === 'thread' && topic.slackSubscribed === false
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

/** The latest activity the quiet rule looks at: the topic's own, or for Main anything in the channel. */
export function latestActivityTs(topic: Topic): Topic['activity']['lastActivityTs'] {
  const channel = topic.kind === 'main' ? topic.activity.channelLastActivityTs : undefined
  return channel === undefined ? topic.activity.lastActivityTs : maxTs(topic.activity.lastActivityTs, channel)
}

/** Whether the quiet window has passed since the last activity. Pins and unread do not count here. */
export function isOlderThanQuietWindow(topic: Topic, ctx: RuleContext): boolean {
  return ctx.now - tsToMillis(latestActivityTs(topic)) > quietDaysOf(ctx) * DAY
}

export function topicStatus(topic: Topic, ctx: RuleContext): TopicStatus {
  if (topic.channel.ignored) return 'ignored'
  if (isUnsubscribed(topic)) return 'unsubscribed'
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

/**
 * Whether an open topic belongs in the sidebar at all (spec section 5,
 * "Which threads"): Main always; a thread only when the user follows it in
 * Slack or it has an unread mention of the user.
 */
export function isSidebarCandidate(topic: Topic): boolean {
  if (topic.kind !== 'thread') return true
  return isFollowed(topic) || hasUnreadMention(topic)
}

export type SidebarPlacement = 'pinned' | 'recent' | 'hidden'

/**
 * Where a topic sits in the sidebar. Every pinned topic is in Pinned, even
 * when resolved, quiet or unfollowed; ignored channels never show; an open
 * topic is in Recent when it is a sidebar candidate.
 */
export function sidebarPlacement(topic: Topic, ctx: RuleContext): SidebarPlacement {
  const status = topicStatus(topic, ctx)
  if (status === 'ignored') return 'hidden'
  if (isPinned(topic)) return 'pinned'
  return status === 'open' && isSidebarCandidate(topic) ? 'recent' : 'hidden'
}

/** A pinned resolved row is dimmed with a check and has no hover Resolve. */
export function showsResolvedCheck(topic: Topic, ctx: RuleContext): boolean {
  return sidebarPlacement(topic, ctx) === 'pinned' && isResolved(topic)
}

export function canResolveOnHover(topic: Topic): boolean {
  return !isResolved(topic)
}

export const RowTag = Schema.Literals(['main', 'reopened', 'unsubscribed'])
export type RowTag = typeof RowTag.Type

/** Tags after the title, in display order. */
export function rowTags(topic: Topic): ReadonlyArray<RowTag> {
  const tags: RowTag[] = []
  if (topic.kind === 'main') tags.push('main')
  if (showsReopenedTag(topic)) tags.push('reopened')
  if (isUnsubscribed(topic)) tags.push('unsubscribed')
  return tags
}

/** Whether a topic appears on All topics: everything except ignored channels. */
export function showsInAllTopics(topic: Topic): boolean {
  return !topic.channel.ignored
}

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
