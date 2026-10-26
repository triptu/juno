/**
 * Which replies of a thread the store has proven it holds (architecture
 * 5.5 and 5.6, specs/threadranges.qnt). Main's history trusts only the
 * `synced_ranges` its pages recorded; threads do the same with
 * `thread_ranges`, never with `reply_count`.
 *
 * A range says every reply with `from_ts < ts <= to_ts` is stored. A
 * `conversations.replies` page proves the stretch from its `oldest` bound
 * (the root without one) to its last reply, or to its `latest` bound when
 * it has nothing more (a `page` range). A page that reached the newest
 * reply on a socket connection that has not dropped since has a `live`
 * tail: every later reply arrives as an event, so the view shows the
 * replies after `to_ts` as continuous. A live range does not merge with the
 * ranges above it. When its tail ends (a drop, or a new run of the sync),
 * the replies up to the newest one the socket delivered for it, in order
 * (`heard_ts`), stay shown and counted, but `to_ts` stays where pages
 * proved it, so the next open reads that stretch again and only pages
 * close the rest. A followed thread's tail is
 * then `held`: the reconnect's `getView` brings every unread reply, so the
 * unread count can stay exact, but the view no longer shows past the range.
 * An unfollowed thread's tail is `none`.
 *
 * A `getView` row's range (`view`) counts for the unread count only: Juno
 * trusts it to carry every unread reply, as it did before ranges, but not
 * to show replies as continuous, since a reply it leaves out (the user's
 * own, one past a cap) would be hidden and never fetched.
 *
 * Two stored replies are continuous only when one page range covers both;
 * the topic view clips a thread's window at the first boundary that is not
 * and fetches across it when the user scrolls near it. Pure functions,
 * shared by the sync (writes, counts) and the engine (the window).
 */
import { compareTs, maxTs, minTs } from '@juno/slack-schema'

export type RangeTail = 'none' | 'live' | 'held'

export interface ThreadRange {
  /** `page`: proven by replies pages, shown and counted. `view`: a `getView` row's, counted only. */
  readonly kind: 'page' | 'view'
  readonly from_ts: string
  readonly to_ts: string
  readonly tail: RangeTail
  /** The newest reply the socket delivered after `to_ts` while the tail was live (`hearReply`). */
  readonly heard_ts?: string | null | undefined
}

/** The ranges the view may show as continuous. */
const shown = (ranges: ReadonlyArray<ThreadRange>): ReadonlyArray<ThreadRange> => ranges.filter((r) => r.kind === 'page')

/** Later than every ts. */
const END = '9999999999.999999'

/** The newest reply a range holds: its pages' end, or the newest reply heard after it. */
const reach = (range: ThreadRange): string =>
  range.heard_ts === null || range.heard_ts === undefined || compareTs(range.heard_ts, range.to_ts) <= 0 ? range.to_ts : range.heard_ts

/** The newest ts a range shows as continuous: past `to_ts` while its tail is live. */
const shownTo = (range: ThreadRange): string => (range.tail === 'live' ? END : reach(range))

/** The newest ts a range vouches for in the unread count: a held tail still counts. */
const countedTo = (range: ThreadRange): string => (range.tail === 'none' ? reach(range) : END)

/**
 * `incoming` merged with the ranges whose pages it touches. A live tail
 * does not join the ranges above it: the replies between arrived as events,
 * and a drop may lose some still on their way, so only pages may close that
 * stretch. A merged range keeps a live tail, which covers all of it, or
 * else a held one.
 */
export function mergeRange(ranges: ReadonlyArray<ThreadRange>, incoming: ThreadRange): { readonly range: ThreadRange; readonly replaced: ReadonlyArray<ThreadRange> } {
  const replaced = ranges.filter((r) => r.kind === incoming.kind && compareTs(r.from_ts, incoming.to_ts) <= 0 && compareTs(r.to_ts, incoming.from_ts) >= 0)
  let from = incoming.from_ts
  let to = incoming.to_ts
  let heard = reach(incoming)
  const tails = new Set<RangeTail>([incoming.tail])
  for (const r of replaced) {
    from = minTs(from, r.from_ts)
    to = maxTs(to, r.to_ts)
    heard = maxTs(heard, reach(r))
    tails.add(r.tail)
  }
  const tail: RangeTail = tails.has('live') ? 'live' : tails.has('held') ? 'held' : 'none'
  return { range: { kind: incoming.kind, from_ts: from, to_ts: to, tail, ...(compareTs(heard, to) > 0 ? { heard_ts: heard } : {}) }, replaced }
}

/**
 * Recording `incoming` would change nothing that matters: a range already
 * holds it, or a live range already holds its start and so every reply
 * after it (a later live view only moves `to_ts` on).
 */
export const addsNothing = (ranges: ReadonlyArray<ThreadRange>, incoming: ThreadRange): boolean => {
  const { range, replaced } = mergeRange(ranges, incoming)
  const held = replaced[0]
  if (replaced.length === 1 && held !== undefined && held.from_ts === range.from_ts && held.to_ts === range.to_ts && held.tail === range.tail && reach(held) === reach(range)) return true
  return incoming.tail === 'live' && ranges.some((r) => r.kind === incoming.kind && r.tail === 'live' && compareTs(r.from_ts, incoming.from_ts) <= 0 && compareTs(incoming.from_ts, r.to_ts) <= 0)
}

/** The stored messages `older` and `newer` (the root counts as a message) have nothing unknown between them. */
export const continuous = (ranges: ReadonlyArray<ThreadRange>, older: string, newer: string): boolean =>
  shown(ranges).some((r) => compareTs(r.from_ts, older) <= 0 && compareTs(newer, shownTo(r)) <= 0)

/**
 * Every reply after `from` up to the root's `latest_reply` is stored and
 * shown as continuous: `from` is at or past it, or one range covers both.
 */
export const provenToEnd = (ranges: ReadonlyArray<ThreadRange>, from: string, latestReply: string | undefined): boolean =>
  latestReply === undefined ||
  compareTs(from, latestReply) >= 0 ||
  shown(ranges).some((r) => compareTs(r.from_ts, from) <= 0 && compareTs(latestReply, shownTo(r)) <= 0)

/**
 * The unread count is exact: the pointer (the root when the thread was never
 * read) is at or past the latest reply, or one range reaches from it to the
 * end, through a tail that is not `none` or up to the latest reply. A `live`
 * and a `held` tail count the same here, and this is all `reindexTopics`
 * reads of a range, so the store's `topic_inputs` trigger keeps a topic's
 * index when a tail moves between them.
 */
export const countExact = (ranges: ReadonlyArray<ThreadRange>, pointer: string, latestReply: string | undefined): boolean =>
  latestReply === undefined ||
  compareTs(pointer, latestReply) >= 0 ||
  ranges.some((r) => compareTs(r.from_ts, pointer) <= 0 && compareTs(pointer, countedTo(r)) <= 0 && (r.tail !== 'none' || compareTs(latestReply, reach(r)) <= 0))

/** The range that holds `ts`: the stretch of continuous replies it belongs to. */
export const rangeHolding = (ranges: ReadonlyArray<ThreadRange>, ts: string): ThreadRange | undefined =>
  shown(ranges).find((r) => compareTs(r.from_ts, ts) <= 0 && compareTs(ts, shownTo(r)) <= 0)

/**
 * What one `conversations.replies` page proved. `oldest` and `latest` are
 * the request's bounds, `replies` the ts of the replies it returned (root
 * left out), oldest first. `live`: the socket connection was up when the
 * request started and has not dropped since. It never reaches past the
 * last reply by Juno's clock, which may run ahead of Slack's; a live tail
 * covers what comes after. Undefined when it proved nothing.
 */
export function pageRange(page: {
  readonly threadTs: string
  readonly oldest?: string | undefined
  readonly latest?: string | undefined
  readonly replies: ReadonlyArray<string>
  readonly hasMore: boolean
  readonly live: boolean
  readonly kind?: ThreadRange['kind']
}): ThreadRange | undefined {
  const kind = page.kind ?? 'page'
  const from = page.oldest ?? page.threadTs
  const last = page.replies.at(-1)
  const closed = last === undefined || compareTs(last, from) <= 0 ? undefined : { kind, from_ts: from, to_ts: last, tail: 'none' as const }
  if (page.hasMore) return closed
  if (page.latest !== undefined) return compareTs(page.latest, from) <= 0 ? undefined : { kind, from_ts: from, to_ts: page.latest, tail: 'none' }
  if (page.live) return { kind, from_ts: from, to_ts: last === undefined ? from : maxTs(last, from), tail: 'live' }
  return closed
}
