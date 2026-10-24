/**
 * Which replies of a thread the store has proven it holds (architecture
 * 5.5 and 5.6, specs/thread-coverage.qnt). Main's history trusts only the
 * `synced_ranges` its pages recorded; threads do the same with
 * `thread_ranges`, never with `reply_count`.
 *
 * A range says every reply with `from_ts < ts <= to_ts` is stored. A
 * `conversations.replies` page proves the stretch from its `oldest` bound
 * (the root without one) to its last reply, or to its `latest` bound when
 * it has nothing more. A page that reached the newest reply on a socket
 * connection that has not dropped since has a `live` tail: every later
 * reply arrives as an event, so the view shows the replies after `to_ts`
 * as continuous. Socket events never move `to_ts`, and a live range does not
 * merge with the ranges above it, since a drop may lose replies still on
 * their way; only pages close that stretch. A drop ends the live tail: a
 * followed thread's tail is `held` (the reconnect's `getView` brings every
 * unread reply, so the unread count can still be exact, but a read reply
 * sent during the drop may be missing), an unfollowed thread's is `none`.
 *
 * Two stored replies are continuous only when one range covers both; the
 * topic view clips a thread's window at the first boundary that is not and
 * fetches across it when the user scrolls near it. Pure functions, shared
 * by the sync (writes, counts) and the engine (the window).
 */
import { compareTs, maxTs, minTs } from '@juno/slack-schema'

export type RangeTail = 'none' | 'live' | 'held'

export interface ThreadRange {
  readonly from_ts: string
  readonly to_ts: string
  readonly tail: RangeTail
}

/** Later than every ts. */
const END = '9999999999.999999'

/** The newest ts a range shows as continuous: past `to_ts` while its tail is live. */
const shownTo = (range: ThreadRange): string => (range.tail === 'live' ? END : range.to_ts)

/** The newest ts a range vouches for in the unread count: a held tail still counts. */
const countedTo = (range: ThreadRange): string => (range.tail === 'none' ? range.to_ts : END)

/**
 * `incoming` merged with the ranges whose pages it touches. A live tail
 * does not join the ranges above it: the replies between arrived as events,
 * and a drop may lose some still on their way, so only pages may close that
 * stretch. A merged range keeps a live tail, which covers all of it, or
 * else a held one.
 */
export function mergeRange(ranges: ReadonlyArray<ThreadRange>, incoming: ThreadRange): { readonly range: ThreadRange; readonly replaced: ReadonlyArray<ThreadRange> } {
  const replaced = ranges.filter((r) => compareTs(r.from_ts, incoming.to_ts) <= 0 && compareTs(r.to_ts, incoming.from_ts) >= 0)
  let from = incoming.from_ts
  let to = incoming.to_ts
  const tails = new Set<RangeTail>([incoming.tail])
  for (const r of replaced) {
    from = minTs(from, r.from_ts)
    to = maxTs(to, r.to_ts)
    tails.add(r.tail)
  }
  const tail: RangeTail = tails.has('live') ? 'live' : tails.has('held') ? 'held' : 'none'
  return { range: { from_ts: from, to_ts: to, tail }, replaced }
}

/** The stored messages `older` and `newer` (the root counts as a message) have nothing unknown between them. */
export const continuous = (ranges: ReadonlyArray<ThreadRange>, older: string, newer: string): boolean =>
  ranges.some((r) => compareTs(r.from_ts, older) <= 0 && compareTs(newer, shownTo(r)) <= 0)

/**
 * Every reply after `from` up to the root's `latest_reply` is stored and
 * shown as continuous: `from` is at or past it, or one range covers both.
 */
export const provenToEnd = (ranges: ReadonlyArray<ThreadRange>, from: string, latestReply: string | undefined): boolean =>
  latestReply === undefined ||
  compareTs(from, latestReply) >= 0 ||
  ranges.some((r) => compareTs(r.from_ts, from) <= 0 && compareTs(latestReply, shownTo(r)) <= 0)

/**
 * The unread count is exact: the pointer (the root when the thread was never
 * read) is at or past the latest reply, or one range reaches from it to the
 * end, through a tail that is not `none` or up to the latest reply.
 */
export const countExact = (ranges: ReadonlyArray<ThreadRange>, pointer: string, latestReply: string | undefined): boolean =>
  latestReply === undefined ||
  compareTs(pointer, latestReply) >= 0 ||
  ranges.some((r) => compareTs(r.from_ts, pointer) <= 0 && compareTs(pointer, countedTo(r)) <= 0 && (r.tail !== 'none' || compareTs(latestReply, r.to_ts) <= 0))

/** The range that holds `ts`: the stretch of continuous replies it belongs to. */
export const rangeHolding = (ranges: ReadonlyArray<ThreadRange>, ts: string): ThreadRange | undefined =>
  ranges.find((r) => compareTs(r.from_ts, ts) <= 0 && compareTs(ts, shownTo(r)) <= 0)

/**
 * What one `conversations.replies` page proved. `oldest` and `latest` are
 * the request's bounds, `replies` the ts of the replies it returned (root
 * left out), oldest first. `live`: the socket connection was up when the
 * request started and has not dropped since. Undefined when it proved
 * nothing.
 */
export function pageRange(page: {
  readonly threadTs: string
  readonly oldest?: string | undefined
  readonly latest?: string | undefined
  readonly replies: ReadonlyArray<string>
  readonly hasMore: boolean
  readonly requestedAt: string
  readonly live: boolean
}): ThreadRange | undefined {
  const from = page.oldest ?? page.threadTs
  const last = page.replies.at(-1)
  if (page.hasMore) return last === undefined || compareTs(last, from) <= 0 ? undefined : { from_ts: from, to_ts: last, tail: 'none' }
  if (page.latest !== undefined) return compareTs(page.latest, from) <= 0 ? undefined : { from_ts: from, to_ts: page.latest, tail: 'none' }
  // Up to now, but Juno's clock may be ahead of Slack's: without a live tail, only up to the last reply.
  if (page.live) return { from_ts: from, to_ts: maxTs(page.requestedAt, last ?? from), tail: 'live' }
  return last === undefined || compareTs(last, from) <= 0 ? undefined : { from_ts: from, to_ts: last, tail: 'none' }
}
