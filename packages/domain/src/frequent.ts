import { isDm, type ConversationKind } from './channel'

const DAY = 86_400_000

/** A conversation to rank, with activity in epoch milliseconds. */
interface Destination {
  readonly id: string
  readonly kind: ConversationKind
  readonly lastActivityAt: number
}

/** One use of a conversation: an own send, or a visit to one of its topics, at epoch milliseconds. */
export interface Use {
  readonly channel: string
  readonly at: number
}

/** Each use in the last 30 days counts `0.5 ^ (age_in_days / 7)`; with the latest use, by conversation. */
export function scoresOf(uses: ReadonlyArray<Use>, now: number): Map<string, { score: number; latest: number }> {
  const scores = new Map<string, { score: number; latest: number }>()
  for (const { channel, at } of uses) {
    const age = (now - at) / DAY
    if (age < 0 || age > 30) continue
    const previous = scores.get(channel)
    scores.set(channel, { score: (previous?.score ?? 0) + 0.5 ** (age / 7), latest: Math.max(previous?.latest ?? 0, at) })
  }
  return scores
}

/**
 * Conversations by use: the most used first, ties by the latest use. Unused
 * ones follow, those in `preferred` first (a name that starts with what was
 * typed), then DMs before channels, then by latest activity.
 */
export function rankConversations(
  conversations: ReadonlyArray<Destination>,
  uses: ReadonlyArray<Use>,
  now: number,
  preferred: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> {
  const scores = scoresOf(uses, now)
  return conversations
    .toSorted((a, b) => {
      const left = scores.get(a.id)
      const right = scores.get(b.id)
      if (left !== undefined && right !== undefined) return right.score - left.score || right.latest - left.latest || a.id.localeCompare(b.id)
      if (left !== undefined) return -1
      if (right !== undefined) return 1
      return Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || Number(isDm(b.kind)) - Number(isDm(a.kind)) || b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id)
    })
    .map(({ id }) => id)
}
