/**
 * Thread fetches for an opened topic (architecture 5.5, `open.ts`). Every
 * page records the range of replies it proved (`threadRanges.ts`); the
 * store trusts nothing else about which replies it holds.
 */
import { compareTs, maxTs, millisToTs, tsToMillis, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { connectionOf, stillConnected, type SyncContext } from './context'
import { laterLane, nowTs, OPEN_FETCH_MAX, OPEN_PAGE, storedInFull, unknownSenders, type FetchLane, type FetchReport, type OpenError, type OpenServices } from './openShared'
import { applyPage, threadTopicOf } from './pages'
import { continuous, pageRange, provenToEnd, rangeHolding, type ThreadRange } from './threadRanges'
import { addThreadRange, readMessage, readState, threadRanges } from './write'

type RootContent = Pick<MessageRow, 'reply_count' | 'latest_reply' | 'user_id' | 'text' | 'blocks_json'>

interface RepliesRange {
  /** Replies after it; the root's own when absent. */
  readonly oldest?: string
  /** Replies up to it. */
  readonly latest?: string
}

/**
 * Pages of `conversations.replies` forward from `range.oldest` (the root
 * when absent), at most `max` messages. Each page lands with the range it
 * proved (`threadRanges.ts`) in one transaction, or with `atOnce` all of
 * them in one after the last. The first call runs on `lane`, the rest on
 * `later`. Returns what it stored and whether it reached the end of the
 * range.
 */
const pageReplies = (
  ctx: SyncContext,
  channel: string,
  threadTs: string,
  range: RepliesRange,
  max: number,
  lane: FetchLane,
  { atOnce = false, later = lane }: { readonly atOnce?: boolean; readonly later?: FetchLane } = {},
): Effect.Effect<{ readonly messages: ReadonlyArray<Message>; readonly reachedEnd: boolean }, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const messages: Array<Message> = []
    // One page's writes: its range and its messages.
    const land = (page: { readonly messages: ReadonlyArray<Message>; readonly has_more?: boolean | undefined }, oldest: string | undefined, replies: ReadonlyArray<string>, requestedAt: string, connection: ReturnType<typeof connectionOf>) =>
      Effect.gen(function* () {
        // Live only when no drop came between the request and now (`stillConnected`), read as the range is written.
        const live = range.latest === undefined && page.has_more !== true && stillConnected(ctx, connection)
        yield* addThreadRange(channel, threadTs, pageRange({ threadTs, oldest, latest: range.latest, replies, hasMore: page.has_more === true, live }))
        // The thread is re-indexed with the range, also when the page changed no message.
        yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [threadTopicOf(channel, threadTs)] })
      })
    // With `atOnce`, every page lands in one transaction after the last one (`fetchThread`).
    const writes: Array<ReturnType<typeof land>> = []
    let cursor: string | undefined
    // Where the next page starts: after the last reply of the one before.
    let from = range.oldest
    let onLane = lane
    while (true) {
      const requestedAt = yield* nowTs
      const connection = connectionOf(ctx)
      const page = yield* api.call(
        'conversations.replies',
        {
          channel,
          ts: threadTs as Ts,
          limit: OPEN_PAGE,
          inclusive: true,
          ...(range.oldest === undefined ? {} : { oldest: range.oldest }),
          ...(range.latest === undefined ? {} : { latest: range.latest }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        { lane: onLane, reason: 'open' },
      )
      onLane = later
      cursor = page.response_metadata?.next_cursor
      // More without a cursor is the end of what can be read, not of the thread: it proves only up to its last reply.
      const more = page.has_more && cursor !== undefined && cursor !== ''
      const replies = page.messages.filter((message) => message.ts !== threadTs).map((message) => message.ts)
      const write = land(page, from, replies, requestedAt, connection)
      if (atOnce) writes.push(write)
      else yield* transaction(write)
      messages.push(...page.messages)
      from = replies.at(-1) ?? from
      const done = !more || messages.length >= max
      if (done && writes.length > 0) yield* transaction(Effect.forEach(writes, (each) => each, { discard: true }))
      if (!more) return { messages, reachedEnd: !page.has_more }
      if (messages.length >= max) return { messages, reachedEnd: false }
      yield* Effect.yieldNow
    }
  })

/** A thread's ranges from replies pages, oldest first: a `getView` row's prove nothing for what to fetch. */
const pageRanges = (channel: string, threadTs: string): Effect.Effect<ReadonlyArray<ThreadRange>, SqlError, StoreWriter> =>
  Effect.map(threadRanges(channel, threadTs), (ranges) => ranges.filter((r) => r.kind === 'page'))

/** The thread's root and its page ranges. */
const threadState = (channel: string, threadTs: string): Effect.Effect<{ readonly root: RootContent | undefined; readonly ranges: ReadonlyArray<ThreadRange> }, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const root = yield* readMessage(channel, threadTs)
    return { root, ranges: yield* pageRanges(channel, threadTs) }
  })

/** The newest range: the one with the latest start (ranges never overlap). */
const newestRange = (ranges: ReadonlyArray<ThreadRange>): ThreadRange | undefined => ranges.at(-1)

/** The stretch that holds `ts` reaches back to the root. */
const fromRoot = (ranges: ReadonlyArray<ThreadRange>, threadTs: string, ts: string): boolean => {
  const holding = rangeHolding(ranges, ts)
  return holding !== undefined && compareTs(holding.from_ts, threadTs) <= 0
}

/** The thread's messages the view shows next to `ts`: the newest before it and the oldest after it. */
const neighbours = (channel: string, threadTs: string, ts: string): Effect.Effect<{ readonly below: string | undefined; readonly above: string | undefined }, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ below: string | null; above: string | null }>`
      SELECT
        (SELECT max(ts) FROM messages WHERE channel = ${channel} AND (thread_ts = ${threadTs} OR ts = ${threadTs}) AND (deleted = 0 OR ts = ${threadTs}) AND ts < ${ts}) AS below,
        (SELECT min(ts) FROM messages WHERE channel = ${channel} AND thread_ts = ${threadTs} AND deleted = 0 AND ts > ${ts}) AS above`
    return { below: rows[0]?.below ?? undefined, above: rows[0]?.above ?? undefined }
  })

/**
 * Opening a thread proves it back to its floor: the root when the thread
 * fits one open, else the read pointer, so every unread reply is stored and
 * the "N new" count is exact. The first time (no range): the replies from
 * the floor on, landing in one transaction once the last page is in, so the
 * window that stands in with what the store holds (`standIn` in the engine)
 * turns into the proven one in one step and never shows a first page alone. After that: the replies after the newest range, then, when
 * it does not reach back to the floor, the replies from the floor up to it.
 * At most `OPEN_FETCH_MAX` messages in all. A long thread never read has no
 * floor: no budget makes its count exact, and the view fetches as it
 * scrolls.
 */
export const fetchThread = (ctx: SyncContext, channel: string, threadTs: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const topic = threadTopicOf(channel, threadTs)
    const before = yield* threadState(channel, threadTs)
    const reads = yield* readState(topic)
    const pointer = reads.lastReadTs !== undefined && compareTs(reads.lastReadTs, threadTs) > 0 ? reads.lastReadTs : undefined
    const long = (before.root?.reply_count ?? 0) > OPEN_FETCH_MAX
    const floor = long ? pointer : threadTs
    const messages: Array<Message> = []
    const newest = newestRange(before.ranges)
    if (newest === undefined) {
      const first = yield* pageReplies(ctx, channel, threadTs, floor === undefined || floor === threadTs ? {} : { oldest: floor }, OPEN_FETCH_MAX, lane, { atOnce: true, later: laterLane(lane) })
      messages.push(...first.messages)
    } else {
      // From the range's edge, also while its tail is live: the replies that came as events then have a page's proof.
      const tail = yield* pageReplies(ctx, channel, threadTs, { oldest: newest.to_ts }, OPEN_FETCH_MAX, lane, { later: laterLane(lane) })
      messages.push(...tail.messages)
      const ranges = yield* pageRanges(channel, threadTs)
      const after = newestRange(ranges)
      if (floor !== undefined && after !== undefined && compareTs(after.from_ts, floor) > 0 && messages.length < OPEN_FETCH_MAX) {
        const start = rangeHolding(ranges, floor)?.to_ts ?? floor
        const back = yield* pageReplies(ctx, channel, threadTs, { ...(start === threadTs ? {} : { oldest: start }), latest: after.from_ts }, OPEN_FETCH_MAX - messages.length, laterLane(lane))
        messages.push(...back.messages)
      }
    }
    const last = newestRange(yield* pageRanges(channel, threadTs))
    return { fetched: true, complete: last !== undefined && compareTs(last.from_ts, threadTs) <= 0, unknownUsers: yield* unknownSenders(messages) }
  })

/** Replies the second page of a step aims to hold, below a page so it holds them (the root takes one place). */
const STEP_REPLIES = 90

/**
 * The replies just before `before`, the first row the view shows. Nothing
 * when the store proves the stretch below it. Otherwise one step across the
 * gap between the range that holds `before` and the newest range below it
 * (the root when there is none), at most two calls, using no count:
 *
 * 1. One page forward from the bottom of the gap. When it reaches the top,
 *    the gap is closed and the view grows.
 * 2. Otherwise Slack pages replies forward only, so the replies just under
 *    the view come from a time bound: the first page measured how densely
 *    the gap's replies come, and the bound should hold about
 *    `STEP_REPLIES` of them, up to the top. When they all fit, the page
 *    starts where the first ended.
 *
 * The view grows only by replies that join its first row; replies that do
 * not (a denser stretch than measured) are proven too, and the next step
 * goes on from there, so every step makes progress.
 */
export const olderThread = (ctx: SyncContext, channel: string, threadTs: string, before: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    if (compareTs(before, threadTs) <= 0) return { fetched: false, complete: true, unknownUsers: [] }
    const { ranges } = yield* threadState(channel, threadTs)
    const below = (yield* neighbours(channel, threadTs, before)).below ?? threadTs
    if (continuous(ranges, below, before)) return { fetched: false, complete: fromRoot(ranges, threadTs, before), unknownUsers: [] }
    const top = rangeHolding(ranges, before)?.from_ts ?? before
    const bottom = ranges.reduce<string>((acc, r) => (compareTs(r.to_ts, top) < 0 && compareTs(r.to_ts, acc) > 0 ? r.to_ts : acc), threadTs)
    const messages: Array<Message> = []
    const first = yield* pageReplies(ctx, channel, threadTs, { ...(bottom === threadTs ? {} : { oldest: bottom }), latest: top }, OPEN_PAGE, lane)
    messages.push(...first.messages)
    const reached = first.messages.filter((message) => message.ts !== threadTs).at(-1)?.ts
    if (!first.reachedEnd && reached !== undefined && compareTs(reached, top) < 0) {
      const spanned = tsToMillis(reached as Ts) - tsToMillis(bottom as Ts)
      const left = tsToMillis(top as Ts) - tsToMillis(reached as Ts)
      const replies = first.messages.length - 1
      // About this many replies are left before the top, if they come as densely as the first page's.
      const estimate = spanned > 0 ? (replies * left) / spanned : Number.POSITIVE_INFINITY
      const bound = estimate <= STEP_REPLIES ? reached : maxTs(reached, millisToTs(Math.floor(tsToMillis(top as Ts) - (left * STEP_REPLIES) / estimate)))
      const second = yield* pageReplies(ctx, channel, threadTs, { oldest: compareTs(bound, top) < 0 ? bound : reached, latest: top }, OPEN_PAGE, lane)
      messages.push(...second.messages)
    }
    return { fetched: true, complete: fromRoot(yield* pageRanges(channel, threadTs), threadTs, before), unknownUsers: yield* unknownSenders(messages) }
  })

/**
 * The replies just after `after`, the last row the view shows: one page
 * from it, up to where the next proven range starts when there is one. Nothing when the
 * store proves the stretch above it. `complete`: nothing after it is
 * unknown.
 */
export const newerThread = (ctx: SyncContext, channel: string, threadTs: string, after: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const { root, ranges } = yield* threadState(channel, threadTs)
    const latestReply = root?.latest_reply ?? undefined
    const above = (yield* neighbours(channel, threadTs, after)).above
    const known = above === undefined ? provenToEnd(ranges, after, latestReply) : continuous(ranges, after, above)
    if (known) return { fetched: false, complete: provenToEnd(ranges, after, latestReply), unknownUsers: [] }
    // Up to where the next proven range starts (replies between that only an event or a search brought are read
    // again); with none, to the end while the socket is up (a live tail), else to the latest reply Juno knows of,
    // so a page that finds nothing still proves the stretch it read.
    const next = ranges.find((r) => compareTs(r.from_ts, after) > 0)?.from_ts
    const latest = next ?? (ctx.socket.connected ? undefined : latestReply)
    const { messages } = yield* pageReplies(ctx, channel, threadTs, { oldest: after, ...(latest === undefined ? {} : { latest }) }, OPEN_PAGE, lane)
    const now = yield* threadState(channel, threadTs)
    return { fetched: true, complete: provenToEnd(now.ranges, after, now.root?.latest_reply ?? undefined), unknownUsers: yield* unknownSenders(messages) }
  })

/**
 * A jump to `ts`: the page from the newest reply stored in full before it up
 * to it, and when that page does not reach it, the page that starts at it.
 * Each records the range it proved; the replies left between stay unknown
 * until the view scrolls to them.
 */
export const threadAt = (ctx: SyncContext, channel: string, threadTs: string, ts: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    if (yield* storedInFull(channel, ts)) return { fetched: false, complete: false, unknownUsers: [] }
    const sql = yield* StoreWriter
    // The newest reply stored in full before the message, else the root.
    const below = (yield* sql<{ ts: string | null }>`
      SELECT max(ts) AS ts FROM messages
      WHERE channel = ${channel} AND thread_ts = ${threadTs} AND ts <> ${threadTs} AND ts < ${ts} AND deleted = 0 AND partial = 0`)[0]?.ts ?? threadTs
    const near = yield* pageReplies(ctx, channel, threadTs, { oldest: below, latest: ts }, OPEN_PAGE, lane)
    const messages = [...near.messages]
    if (!near.reachedEnd) {
      const far = yield* pageReplies(ctx, channel, threadTs, { oldest: ts }, OPEN_PAGE, lane)
      messages.push(...far.messages)
    }
    return { fetched: true, complete: false, unknownUsers: yield* unknownSenders(messages) }
  })
