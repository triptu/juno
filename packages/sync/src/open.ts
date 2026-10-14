/**
 * Fetches for an opened topic (architecture 5.5, M4): what the store lacks
 * when a topic is opened, the page before a message when the user scrolls
 * up, and a refresh of the open topics after a reconnect (5.8). Every page
 * lands through `applyPage`, so the merge rules, reactions and
 * `reindexTopics` run as they do for boot pages.
 *
 * - A thread the first time: its replies from the root, in pages of 100,
 *   at most `OPEN_FETCH_MAX`; a very long thread starts at the read pointer
 *   instead, so every unread reply is stored. Once every reply is stored,
 *   later opens ask only for replies after the newest stored one.
 * - Main: `conversations.history` since the newest synced range (the newest
 *   page when there is none), then older pages until history reaches the
 *   read pointer, at most `OPEN_FETCH_MAX` messages. Each page records the
 *   range it covered, so the "N new" count is exact once the range reaches
 *   the pointer (`reindexTopics` reads it).
 *
 * Nothing here is called by a live query: only the engine's `topics.open`
 * and `messages.loadOlder` commands and the reconnect step do.
 */
import { compareTs, millisToTs, parseTopicId, type Ts } from '@juno/domain'
import { SlackApi, type SlackApiError } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { applyPage, mainTopicOf, threadTopicOf } from './pages'
import { reindexTopics } from './reindex'
import { addSyncedRange, latestSyncedRange, markRepliesComplete, readMessage, readState } from './write'

/** Messages one open fetches at most to reach the read pointer. */
export const OPEN_FETCH_MAX = 500
/** Messages per page when opening and when loading older messages. */
export const OPEN_PAGE = 100
/** Main's first page when the store has no history of the channel (architecture 5.5). */
export const MAIN_FIRST_PAGE = 50
/** The `from_ts` of a synced range that reaches the start of a conversation. */
export const HISTORY_START = '0000000000.000000'

export type FetchLane = 'interactive' | 'background'

export type OpenError = SlackApiError | SqlError
export type OpenServices = SlackApi | StoreWriter | Invalidation

/** What a fetch did. `fetched`: a call was made. `complete`: the store now holds the topic from its first message. */
export interface FetchReport {
  readonly fetched: boolean
  readonly complete: boolean
  /** Senders on the fetched pages the `users` table lacks; the caller names them. */
  readonly unknownUsers: ReadonlyArray<string>
}

const nowTs = Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))

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

/** The page before `before` (a message ts) of a topic, fetched only when the store does not have it. */
export const fetchOlder = (ctx: SyncContext, topicId: string, before: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> => {
  const topic = fetchableTopic(topicId)
  if (topic === undefined) return Effect.succeed({ fetched: false, complete: true, unknownUsers: [] })
  return topic.kind === 'thread' ? olderThread(ctx, topic.channel, topic.threadTs, before, lane) : olderMain(ctx, topic.channel, before, lane)
}

// Threads

type RootContent = Pick<MessageRow, 'reply_count' | 'user_id' | 'text' | 'blocks_json'>

interface ThreadCoverage {
  readonly root: RootContent | undefined
  /** Live replies stored. */
  readonly stored: number
  readonly newest: string | undefined
  readonly oldest: string | undefined
}

const threadCoverage = (channel: string, threadTs: string): Effect.Effect<ThreadCoverage, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const root = yield* readMessage(channel, threadTs)
    const rows = yield* sql<{ n: number; newest: string | null; oldest: string | null }>`
      SELECT count(*) AS n, max(ts) AS newest, min(ts) AS oldest FROM messages
      WHERE channel = ${channel} AND thread_ts = ${threadTs} AND ts <> ${threadTs} AND deleted = 0`
    return { root, stored: rows[0]?.n ?? 0, newest: rows[0]?.newest ?? undefined, oldest: rows[0]?.oldest ?? undefined }
  })

/** A root the store knows only from a reply; its content has not arrived. */
const isStub = (root: RootContent): boolean =>
  root.user_id === null && root.text === '' && root.blocks_json === null

/** Every reply the root counts is stored. */
const repliesComplete = (coverage: ThreadCoverage): boolean =>
  coverage.root !== undefined && !isStub(coverage.root) && coverage.stored >= coverage.root.reply_count

interface RepliesRange {
  readonly oldest?: string
  readonly latest?: string
}

/**
 * Pages of `conversations.replies` forward from `range.oldest` (the root
 * when absent), at most `max` messages. Returns what it stored and whether
 * it reached the end of the range.
 */
const pageReplies = (
  ctx: SyncContext,
  channel: string,
  threadTs: string,
  range: RepliesRange,
  max: number,
  lane: FetchLane,
): Effect.Effect<{ readonly messages: ReadonlyArray<Message>; readonly reachedEnd: boolean }, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const messages: Array<Message> = []
    let cursor: string | undefined
    while (true) {
      const requestedAt = yield* nowTs
      const page = yield* api.call(
        'conversations.replies',
        {
          channel,
          ts: threadTs as Ts,
          limit: OPEN_PAGE,
          ...(range.oldest === undefined ? {} : { oldest: range.oldest, inclusive: false }),
          ...(range.latest === undefined ? {} : { latest: range.latest }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        { lane, reason: 'open' },
      )
      yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt })
      messages.push(...page.messages)
      cursor = page.response_metadata?.next_cursor
      const more = page.has_more && cursor !== undefined && cursor !== ''
      if (!more) return { messages, reachedEnd: true }
      if (messages.length >= max) return { messages, reachedEnd: false }
      yield* Effect.yieldNow
    }
  })

const fetchThread = (ctx: SyncContext, channel: string, threadTs: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const topic = threadTopicOf(channel, threadTs)
    const before = yield* threadCoverage(channel, threadTs)
    // Every reply stored: only the ones after the newest stored reply can be missing.
    if (repliesComplete(before) && before.newest !== undefined) {
      const { messages } = yield* pageReplies(ctx, channel, threadTs, { oldest: before.newest }, OPEN_FETCH_MAX, lane)
      return { fetched: true, complete: true, unknownUsers: yield* unknownSenders(messages) }
    }
    // A thread longer than one open fetches starts at the read pointer, so every unread reply is stored.
    const reads = yield* readState(topic)
    const long = (before.root?.reply_count ?? 0) > OPEN_FETCH_MAX
    const from = long && reads.lastReadTs !== undefined && compareTs(reads.lastReadTs, threadTs) > 0 ? reads.lastReadTs : undefined
    const { messages, reachedEnd } = yield* pageReplies(ctx, channel, threadTs, from === undefined ? {} : { oldest: from }, OPEN_FETCH_MAX, lane)
    const after = yield* threadCoverage(channel, threadTs)
    const complete = repliesComplete(after)
    // Every reply from `from` (the root when absent) to the newest is stored: the unread count is exact from the pointer on.
    if (reachedEnd) {
      const syncedAt = yield* Clock.currentTimeMillis
      yield* transaction(
        Effect.gen(function* () {
          yield* markRepliesComplete(channel, threadTs, complete, syncedAt, from ?? threadTs)
          yield* reindexTopics([topic], reindexOptions(ctx))
        }),
      )
    }
    return { fetched: true, complete: from === undefined && reachedEnd, unknownUsers: yield* unknownSenders(messages) }
  })

const olderThread = (ctx: SyncContext, channel: string, threadTs: string, before: string, lane: FetchLane): Effect.Effect<FetchReport, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const coverage = yield* threadCoverage(channel, threadTs)
    if (repliesComplete(coverage)) return { fetched: false, complete: true, unknownUsers: [] }
    // The stored replies have a gap at the start; fetch forward from the root up to the oldest stored one.
    const latest = coverage.oldest !== undefined && compareTs(coverage.oldest, before) < 0 ? coverage.oldest : before
    const { messages, reachedEnd } = yield* pageReplies(ctx, channel, threadTs, { latest }, OPEN_PAGE, lane)
    if (reachedEnd) {
      const syncedAt = yield* Clock.currentTimeMillis
      const after = yield* threadCoverage(channel, threadTs)
      yield* transaction(
        Effect.gen(function* () {
          yield* markRepliesComplete(channel, threadTs, repliesComplete(after), syncedAt, threadTs)
          yield* reindexTopics([threadTopicOf(channel, threadTs)], reindexOptions(ctx))
        }),
      )
    }
    return { fetched: true, complete: reachedEnd, unknownUsers: yield* unknownSenders(messages) }
  })

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

/** Senders of `messages` with no `users` row, for the caller to name. */
const unknownSenders = (messages: ReadonlyArray<Message>): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const ids = new Set<string>()
    for (const message of messages) if (message.user !== undefined && /^[UW][A-Z0-9]+$/.test(message.user)) ids.add(message.user)
    if (ids.size === 0) return []
    const sql = yield* StoreWriter
    const known = yield* sql<{ id: string }>`SELECT id FROM users WHERE id IN ${sql.in([...ids])}`
    for (const row of known) ids.delete(row.id)
    return [...ids]
  })
