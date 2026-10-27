/**
 * The sidebar's order while a sync cycle runs (`sidebar.ts`,
 * `sidebarSourceAtom`), apart from the pointer's hold (`holdOrder.ts`).
 */
import type { TopicRow } from '@juno/contract'
import { sameOrder, type ListWindow } from './list'

/**
 * The order while a sync cycle lands rows in a painted list, or the quiet
 * window widens: rows keep their places and new ones go last, so history
 * the warm boot brings from before the launch does not shuffle the list. A
 * row whose activity changed from or to a time after `since` (the engine's
 * start) is live, a message from the socket or the user's own send, or that
 * send deleted, refused or retried, and takes its place by recency at once:
 * before the first row with older activity. Sync cycles run for many
 * seconds every few minutes, so live activity never waits for one to end.
 */
export function keepPainted(shown: ListWindow<TopicRow>, next: ListWindow<TopicRow>, since: number): ReadonlyArray<string> {
  const live = (id: string) => {
    const at = next.rows.get(id)!.lastActivityAt
    const was = shown.rows.get(id)?.lastActivityAt
    return at !== was && (at > since || (was !== undefined && was > since))
  }
  const order = shown.order.filter((id) => next.rows.has(id) && !live(id))
  const known = new Set(order)
  for (const id of next.order) {
    if (known.has(id)) continue
    if (!live(id)) {
      order.push(id)
      continue
    }
    const at = next.rows.get(id)!.lastActivityAt
    const before = order.findIndex((other) => next.rows.get(other)!.lastActivityAt < at)
    order.splice(before < 0 ? order.length : before, 0, id)
  }
  return sameOrder(shown.order, order) ? shown.order : order
}
