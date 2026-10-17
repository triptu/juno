/**
 * Home's suggestions beside Tidy up (SPEC 12;
 * `docs/design/settled-suggestions/README.md`, "More self-management"):
 * Unfollow threads you never open, and Ignore channels you never read. Each
 * rule reads only what the cache knows, and returns the facts the review
 * sheet says, or undefined when the topic must not be proposed.
 */

const DAY = 24 * 60 * 60 * 1000

/** Unfollow: the oldest unread reply is at least this old, */
export const UNFOLLOW_UNREAD_DAYS = 14
/** with at least this many unread replies, */
export const UNFOLLOW_MIN_REPLIES = 5
/** and a reply in this many days, so the thread still moves. */
export const UNFOLLOW_ACTIVE_DAYS = 7
/** Ignore: nothing read in the channel for this long, */
export const IGNORE_UNREAD_DAYS = 30
/** and more than this many messages since. */
export const IGNORE_MIN_MESSAGES = 50

/** What the cache knows about a topic's unread stretch. Times are epoch milliseconds. */
export interface UnreadStretch {
  readonly now: number
  /** The last message the user read. Undefined when nothing is read. */
  readonly lastRead?: number
  /** A thread's root. A pointer at or before it means no reply was read. */
  readonly start?: number
  /** The oldest unread message the cache holds. */
  readonly firstUnread?: number
  readonly lastActivity?: number
  readonly unread: number
  /** The cache holds every message since the pointer, so `unread` is the whole count. */
  readonly exact: boolean
  /** An unread message mentions the user (in the channel, for Ignore). */
  readonly mentionsMe: boolean
  readonly markedUnread: boolean
  readonly pinned: boolean
  /** When the user chose Keep for this suggestion. */
  readonly keptAt?: number
  /** When the user last had the topic open for a minute. */
  readonly visitedAt?: number
}

/** The facts a suggestion's reason says: how many unread, and the last one read. */
export interface Unopened {
  readonly count: number
  /** `count` is what the cache holds; there may be more. */
  readonly atLeast: boolean
  /** The last message read. Absent: no reply was ever read. */
  readonly lastRead?: number
}

const unopened = (input: UnreadStretch, lastRead: number | undefined): Unopened => ({
  count: input.unread,
  atLeast: !input.exact,
  ...(lastRead === undefined ? {} : { lastRead }),
})

/** Keep and a visit restart the wait: the stretch counts from the latest of them. */
const quietSince = (input: UnreadStretch, from: number): number => Math.max(from, input.keptAt ?? 0, input.visitedAt ?? 0)

/**
 * A followed thread to unfollow: replies over two weeks the user has not
 * read, at least `UNFOLLOW_MIN_REPLIES`, the newest in the last
 * `UNFOLLOW_ACTIVE_DAYS`, and none mentions them. Never one marked unread
 * or pinned, which the user meant to come back to.
 */
export function unfollowEvidence(input: UnreadStretch): Unopened | undefined {
  if (input.mentionsMe || input.markedUnread || input.pinned) return undefined
  if (input.unread < UNFOLLOW_MIN_REPLIES || input.firstUnread === undefined || input.lastActivity === undefined) return undefined
  if (input.now - input.lastActivity > UNFOLLOW_ACTIVE_DAYS * DAY) return undefined
  if (input.now - quietSince(input, input.firstUnread) < UNFOLLOW_UNREAD_DAYS * DAY) return undefined
  const never = input.lastRead === undefined || (input.start !== undefined && input.lastRead <= input.start)
  return unopened(input, never ? undefined : input.lastRead)
}

/**
 * A channel to ignore: nothing in it read for `IGNORE_UNREAD_DAYS`, and
 * more than `IGNORE_MIN_MESSAGES` messages since. The pointer's age is
 * what the cache can know: it holds only the quiet window's history.
 * Never a channel with an unread mention of the user, or whose Main is
 * marked unread or pinned.
 */
export function ignoreEvidence(input: UnreadStretch): Unopened | undefined {
  if (input.mentionsMe || input.markedUnread || input.pinned || input.lastRead === undefined) return undefined
  if (input.unread <= IGNORE_MIN_MESSAGES) return undefined
  if (input.now - quietSince(input, input.lastRead) < IGNORE_UNREAD_DAYS * DAY) return undefined
  return unopened(input, input.lastRead)
}
