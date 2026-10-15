import { isDm, type ConversationKind } from './channel'

const DAY = 86_400_000

/** Local destinations eligible for New chat, with activity in epoch milliseconds. */
interface Destination {
  readonly id: string
  readonly kind: ConversationKind
  readonly lastActivityAt: number
}

/** Own sends decay by half each week; unscored DMs fill before channels. */
export function frequentDestinations(
  conversations: ReadonlyArray<Destination>,
  sends: ReadonlyArray<{ readonly channel: string; readonly at: number }>,
  now: number,
): ReadonlyArray<string> {
  const scores = new Map<string, { score: number; latest: number }>()
  for (const { channel, at } of sends) {
    const age = (now - at) / DAY
    if (age < 0 || age > 30) continue
    const previous = scores.get(channel)
    scores.set(channel, { score: (previous?.score ?? 0) + 0.5 ** (age / 7), latest: Math.max(previous?.latest ?? 0, at) })
  }
  return conversations.toSorted((a, b) => {
    const left = scores.get(a.id)
    const right = scores.get(b.id)
    if (left !== undefined && right !== undefined) return right.score - left.score || right.latest - left.latest || a.id.localeCompare(b.id)
    if (left !== undefined) return -1
    if (right !== undefined) return 1
    return Number(isDm(b.kind)) - Number(isDm(a.kind)) || b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id)
  }).slice(0, 6).map(({ id }) => id)
}
