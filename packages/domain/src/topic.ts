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
  readonly unsubscribedAt?: number
  /** Set by "Track replies as a topic". */
  readonly tracked?: boolean
}

export interface TopicActivity {
  readonly lastActivityTs: Ts
  readonly messageCount: number
  readonly unreadCount: number
  /** False when local history may not cover everything since the read pointer. */
  readonly unreadExact?: boolean
  readonly mentionsMe: boolean
  /** Most recent first. */
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
  /** Slack's follow flag, for the bell. Juno's own flag is `overlay.unsubscribedAt`. */
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
