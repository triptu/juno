/**
 * A topic as the rules see it: what the index knows about its activity plus
 * the Juno-only overlay. Everything here is plain data from the store.
 */
import type { ChannelInfo } from './channel'
import type { TopicId, TopicKind, Ts, UserId } from './ids'

export interface TopicOverlay {
  readonly manualTitle?: string
  readonly aiTitle?: string
  /** Wall-clock millis when the user resolved it. */
  readonly resolvedAt?: number
  /** The latest activity at the time of the resolve. Later activity reopens the topic. */
  readonly resolvedActivityTs?: Ts
  readonly reopenedAt?: number
  readonly pinnedAt?: number
}

export interface TopicActivity {
  readonly lastActivityTs: Ts
  /**
   * Main only: the latest activity anywhere in the channel, including replies
   * in its threads. Decides whether the Main row is quiet (spec section 5);
   * the row itself still sorts and shows its own `lastActivityTs`.
   */
  readonly channelLastActivityTs?: Ts
  readonly messageCount: number
  readonly unreadCount: number
  /** False when local history may not cover everything since the read pointer. */
  readonly unreadExact?: boolean
  readonly mentionsMe: boolean
  /** Senders of the latest unread messages (`PARTICIPANT_WINDOW`), most recent first, never you. Empty when read. */
  readonly participants: ReadonlyArray<UserId>
}

export interface TopicPreview {
  /** "You" for own messages, otherwise the sender's display name. */
  readonly sender: string
  /** Latest message text with quote lines stripped. */
  readonly text: string
}

export interface Topic {
  readonly id: TopicId
  readonly kind: TopicKind
  readonly channel: ChannelInfo
  readonly activity: TopicActivity
  readonly overlay: TopicOverlay
  /**
   * Slack's follow flag ("Get notified about new replies"), threads only.
   * `true` when Slack lists the thread as followed, `false` when the user
   * unfollowed it, absent when Slack has said nothing (not followed). Decides
   * whether a thread is in the sidebar. Main has no follow.
   */
  readonly slackSubscribed?: boolean
  /** First message of a thread, for the fallback title. */
  readonly firstMessageText?: string
  readonly preview?: TopicPreview
}

export const DEFAULT_QUIET_DAYS = 7
export const MAX_QUIET_DAYS = 14

/** Time and settings the rules need. */
export interface RuleContext {
  /** Wall-clock millis. */
  readonly now: number
  /** Days without activity before a topic turns quiet. Clamped to 1..14. */
  readonly quietDays?: number
}

export function quietDaysOf(ctx: RuleContext): number {
  const days = ctx.quietDays ?? DEFAULT_QUIET_DAYS
  return Math.min(MAX_QUIET_DAYS, Math.max(1, Math.round(days)))
}
