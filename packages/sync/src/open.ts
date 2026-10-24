/**
 * Fetches for an opened topic (architecture 5.5, M4): what the store lacks
 * when a topic is opened, the page before a message when the user scrolls
 * up, and a refresh of the open topics after a reconnect (5.8). Every page
 * lands through `applyPage`, so the merge rules, reactions and
 * `reindexTopics` run as they do for boot pages.
 *
 * Thread pages record the range of replies they proved (`threadRanges.ts`);
 * the store trusts nothing else about which replies it holds.
 *
 * - A thread: proven back to the root, or to the read pointer for a thread
 *   longer than `OPEN_FETCH_MAX`, in pages of 100. The first time, the
 *   replies from there on; later, the replies after the newest range, then
 *   those from there up to it when it does not reach back that far.
 * - The replies before the first row the view shows, when the store cannot
 *   prove the stretch below it (`messages.loadOlder`): the gap is closed
 *   from its top, by a time bound when it is wider than a page.
 * - The replies after the last row it shows (`messages.loadNewer`): one
 *   page forward from it.
 * - A jump to a message the store lacks in full (a search match, a link):
 *   for a thread, the replies after the newest stored one before it, up to
 *   it, when they fit one page; else the page that starts at it, so a reply
 *   any distance into a long thread costs at most two calls. The replies
 *   left between stay unknown, and the view stops at them until it scrolls
 *   there. For Main, the page that ends at it, recorded as a synced range
 *   like any page.
 * - Main: `conversations.history` since the newest synced range (the newest
 *   page when there is none), then older pages until history reaches the
 *   read pointer, at most `OPEN_FETCH_MAX` messages. Each page records the
 *   range it covered, so the "N new" count is exact once the range reaches
 *   the pointer (`reindexTopics` reads it).
 *
 * Nothing here is called by a live query: only the engine's `topics.open`,
 * `messages.loadOlder`, `messages.loadNewer` and `messages.loadAt` commands
 * and the reconnect step do.
 */
import { compareTs, parseTopicId } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { transaction, type SqlError, StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import type { SyncContext } from './context'
import { HISTORY_START, MAIN_FIRST_PAGE, nowTs, OPEN_FETCH_MAX, OPEN_PAGE, storedInFull, unknownSenders, type FetchLane, type FetchReport, type OpenError, type OpenServices } from './openShared'
import { fetchThread, newerThread, olderThread, threadAt } from './openThread'
import { applyPage, mainTopicOf } from './pages'
import { addSyncedRange, latestSyncedRange, readState } from './write'

export type { FetchLane, FetchReport, OpenError, OpenServices } from './openShared'

/** A topic id the open fetch understands: a thread or a Main. Groups are local and fetch nothing. */
export const fetchableTopic = (topicId: string): { readonly kind: 'thread'; readonly channel: string; readonly threadTs: string } | { readonly kind: 'main'; readonly channel: string } | undefined => {
  const parsed = parseTopicId(topicId)
  if (parsed === undefined) return undefined
  return parsed.kind === 'thread' ? { kind: 'thread', channel: parsed.channel, threadTs: parsed.threadTs } : { kind: 'main', channel: parsed.channel }
}

/** Fetches what the store lacks for a topic being opened. Fails with `SlackApiError` when Slack cannot be asked. */
export const fetchTopic = (ctx: SyncContext, topicId: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> => {
  const topic = fetchableTopic(topicId)
  if (topic === undefined) return Effect.succeed({ fetched: false, complete: true, unknownUsers: [] })
  return topic.kind === 'thread' ? fetchThread(ctx, topic.channel, topic.threadTs, lane) : fetchMain(ctx, topic.channel, lane)
}

/** The message `ts` of a topic and the page around it, fetched only when the store lacks the message in full. */
export const fetchAt = (ctx: SyncContext, topicId: string, ts: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> => {
  const topic = fetchableTopic(topicId)
  if (topic === undefined) return Effect.succeed({ fetched: false, complete: true, unknownUsers: [] })
  return topic.kind === 'thread' ? threadAt(ctx, topic.channel, topic.threadTs, ts, lane) : mainAt(ctx, topic.channel, ts, lane)
}

/** The page before `before` (a message ts) of a topic, fetched only when the store does not have it. */
export const fetchOlder = (ctx: SyncContext, topicId: string, before: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> => {
  const topic = fetchableTopic(topicId)
  if (topic === undefined) return Effect.succeed({ fetched: false, complete: true, unknownUsers: [] })
  return topic.kind === 'thread' ? olderThread(ctx, topic.channel, topic.threadTs, before, lane) : olderMain(ctx, topic.channel, before, lane)
}

/**
 * The replies after `after` (a message ts) of a thread, fetched only when the
 * store cannot prove them. Main has no gaps to close this way: its window
 * holds the newest messages. `complete`: nothing after `after` is unknown.
 */
export const fetchNewer = (ctx: SyncContext, topicId: string, after: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> => {
  const topic = fetchableTopic(topicId)
  if (topic === undefined || topic.kind === 'main') return Effect.succeed({ fetched: false, complete: true, unknownUsers: [] })
  return newerThread(ctx, topic.channel, topic.threadTs, after, lane)
}

// Main

/**
 * One `conversations.history` page, stored with the range it covered in one
 * transaction, so the index of the page already knows the coverage.
 * `floor` is the `oldest` bound of the request: a page with nothing more
 * covers down to it, or to the start of the conversation without one.
 */
const historyPage = (
  ctx: SyncContext,
  channel: string,
  args: { readonly oldest?: string; readonly latest?: string; readonly inclusive?: boolean; readonly limit: number; readonly cursor?: string },
  lane: FetchLane,
): Effect.Effect<{ readonly messages: ReadonlyArray<Message>; readonly from: string; readonly more: boolean; readonly cursor: string | undefined }, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = yield* nowTs
    const page = yield* api.call(
      'conversations.history',
      { channel, ignore_replies: true, no_user_profile: true, ...args },
      { lane, reason: 'open' },
    )
    const cursor = page.response_metadata?.next_cursor
    const more = page.has_more && cursor !== undefined && cursor !== ''
    const oldestSeen = page.messages.at(-1)?.ts
    const from = more && oldestSeen !== undefined ? oldestSeen : (args.oldest ?? HISTORY_START)
    const to = args.latest ?? requestedAt
    yield* transaction(
      Effect.gen(function* () {
        yield* addSyncedRange(channel, from, to)
        yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [mainTopicOf(channel)] })
      }),
    )
    return { messages: page.messages, from, more, cursor: more ? cursor : undefined }
  })

const fetchMain = (ctx: SyncContext, channel: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const messages: Array<Message> = []
    const newest = yield* latestSyncedRange(channel)
    let coveredFrom: string
    if (newest === undefined) {
      const page = yield* historyPage(ctx, channel, { limit: MAIN_FIRST_PAGE }, lane)
      messages.push(...page.messages)
      coveredFrom = page.from
    } else {
      // Everything since the newest range, newest first. A gap too long for the page budget stays a gap.
      let cursor: string | undefined
      let from = newest.from_ts
      while (true) {
        const page = yield* historyPage(ctx, channel, { oldest: newest.to_ts, inclusive: false, limit: OPEN_PAGE, ...(cursor === undefined ? {} : { cursor }) }, lane)
        messages.push(...page.messages)
        if (!page.more) break
        from = page.from
        cursor = page.cursor
        if (messages.length >= OPEN_FETCH_MAX) break
        yield* Effect.yieldNow
      }
      coveredFrom = (yield* latestSyncedRange(channel))?.from_ts ?? from
    }
    // Back to the read pointer, so the unread count is exact.
    const reads = yield* readState(mainTopicOf(channel))
    const pointer = reads.lastReadTs
    const short = (from: string) => pointer !== undefined && from !== HISTORY_START && compareTs(from, pointer) > 0
    while (short(coveredFrom) && messages.length < OPEN_FETCH_MAX) {
      const page = yield* historyPage(ctx, channel, { oldest: pointer!, latest: coveredFrom, inclusive: true, limit: OPEN_PAGE }, lane)
      messages.push(...page.messages)
      coveredFrom = page.from
      if (!page.more) break
      yield* Effect.yieldNow
    }
    const range = yield* latestSyncedRange(channel)
    return { fetched: true, complete: range?.from_ts === HISTORY_START, unknownUsers: yield* unknownSenders(messages) }
  })

/** Main messages stored from `from` up to, not including, `before`, counted up to `limit`. */
const mainStoredBetween = (channel: string, from: string, before: string, limit: number): Effect.Effect<number, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ n: number }>`
      SELECT count(*) AS n FROM (SELECT 1 FROM messages
        WHERE channel = ${channel} AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')
          AND ts >= ${from} AND ts < ${before} LIMIT ${limit})`
    return rows[0]?.n ?? 0
  })

const olderMain = (ctx: SyncContext, channel: string, before: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    // The synced range that holds `before`: history is known to be complete inside it.
    const ranges = yield* sql<{ from_ts: string; to_ts: string }>`
      SELECT from_ts, to_ts FROM synced_ranges WHERE channel = ${channel} AND from_ts <= ${before} AND to_ts >= ${before}`
    const range = ranges[0]
    if (range !== undefined) {
      if (range.from_ts === HISTORY_START) return { fetched: false, complete: true, unknownUsers: [] }
      if ((yield* mainStoredBetween(channel, range.from_ts, before, OPEN_PAGE)) >= OPEN_PAGE) return { fetched: false, complete: false, unknownUsers: [] }
    }
    const page = yield* historyPage(ctx, channel, { latest: range?.from_ts ?? before, inclusive: true, limit: OPEN_PAGE }, lane)
    return { fetched: true, complete: page.from === HISTORY_START, unknownUsers: yield* unknownSenders(page.messages) }
  })

const mainAt = (ctx: SyncContext, channel: string, ts: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    if (yield* storedInFull(channel, ts)) return { fetched: false, complete: false, unknownUsers: [] }
    const page = yield* historyPage(ctx, channel, { latest: ts, inclusive: true, limit: OPEN_PAGE }, lane)
    return { fetched: true, complete: page.from === HISTORY_START, unknownUsers: yield* unknownSenders(page.messages) }
  })
