/**
 * Discovery of thread activity after boot (architecture 5.3): replies inside
 * the window to roots outside it, in threads the user does not follow, which
 * windowed history, history since a cursor and the reconnect path all miss.
 *
 * Preferred source: `search.modules.messages` with `is:thread after:<date>`,
 * newest first (`sort=timestamp`; without it Slack orders by relevance and
 * the pages are an arbitrary sample). One to three pages cover the gap and
 * reach old roots. Matches from conversations the user is not a member of
 * are dropped (search also covers public channels the user is not in). A
 * match is a partial message: it creates rows the store lacks, fills stub
 * roots and moves counters, but never replaces stored content (it carries
 * incomplete fields, including reactions). An unknown root becomes a stub and is fetched.
 * A match that says nothing about its thread (no `thread_ts`, not in the
 * permalink, no `reply_count`) is dropped.
 *
 * Fallback (`discovery: 'history'`): history since the synced range for
 * conversations whose `latest` moved (the catch-up already did that), plus
 * `conversations.replies` since the stored replies for roots whose
 * `latest_reply` moved. It leaves the gap for unfollowed old roots.
 *
 * Live research confirms `is:thread` and the extra thread metadata. Roots
 * outside the returned pages still need their existing lookup.
 *
 * The same pages serve the cold boot's preview search (`searchPreviews`):
 * `after:<date>` without `is:thread`, which live also returns plain
 * messages (research section 10, "Search with an `xoxc` session").
 */
import { compareTs, millisToTs, type Ts } from '@juno/domain'
import { SlackApi, SlackEdge, type SlackApiError } from '@juno/slack'
import { isReply, searchMatchChannelId, searchMatches, type CountEntry, type FlatSearchMatch, type Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { SyncContext } from './context'
import { mergeMessage, mergeRootCounters } from './merge'
import { applyPage } from './pages'
import { nameFirst } from './users'

type Services = SlackApi | SlackEdge | StoreWriter | Invalidation

const DAY = 24 * 60 * 60 * 1000
// Slack search can index a message after a sweep has advanced Juno's local
// cursor, and the two clocks can differ. Five minutes keeps that ordinary
// delay and skew inside the next search while the page cap bounds the work.
const DISCOVERY_OVERLAP_MILLIS = 5 * 60_000

/** `after:` takes a date; the day before `since` keeps every message since that moment in the result. */
const afterDate = (sinceMillis: number): string => new Date(sinceMillis - DAY).toISOString().slice(0, 10)

/** The thread a match belongs to: its `thread_ts`, else the `thread_ts` query parameter of its permalink. */
const threadTsOf = (match: FlatSearchMatch): Ts | undefined => {
  if (match.thread_ts !== undefined) return match.thread_ts
  if (match.permalink === undefined) return undefined
  const value = /[?&]thread_ts=(\d+\.\d+)/.exec(match.permalink)?.[1]
  return value === undefined ? undefined : (value as Ts)
}

/** A match as a partial message, in the thread `threadTs` names. */
const toMessage = (match: FlatSearchMatch, threadTs: Ts | undefined): Message => ({
  type: 'message',
  ts: match.ts,
  ...(match.user === undefined ? {} : { user: match.user }),
  ...(match.text === undefined ? {} : { text: match.text }),
  ...(match.blocks === undefined ? {} : { blocks: match.blocks }),
  ...(match.attachments === undefined ? {} : { attachments: match.attachments }),
  ...(match.files === undefined ? {} : { files: match.files }),
  ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
  ...(match.reply_count === undefined ? {} : { reply_count: match.reply_count }),
  ...(match.latest_reply === undefined ? {} : { latest_reply: match.latest_reply }),
})

/** A match as a message, or `undefined` when it says nothing about a thread. */
const matchToMessage = (match: FlatSearchMatch): Message | undefined => {
  const threadTs = threadTsOf(match)
  if (threadTs === undefined && (match.reply_count ?? 0) === 0) return undefined
  return toMessage(match, threadTs)
}

export interface DiscoverOptions {
  /** Cold boot: a thread first seen here that the user does not follow starts read as of this ts (see `ApplyPageOptions`). */
  readonly seedReadBefore?: string
}

interface SearchPass {
  readonly query: string
  readonly pages: number
  readonly sinceMillis: number
  readonly reason: string
  /** A match as a message to store, or `undefined` to drop it. */
  readonly toMessage: (match: FlatSearchMatch) => Message | undefined
  /** Fetch the people the page names before storing it, so the rows it makes show names, not "Someone". */
  readonly nameFirst?: boolean
  /** After naming, what to store of each conversation's matches. */
  readonly select?: (channel: string, messages: ReadonlyArray<Message>) => Effect.Effect<ReadonlyArray<Message>, SqlError, StoreWriter>
  /** Drop matches whose message and root counters already equal the store. */
  readonly certifyStored?: boolean
}

/**
 * Certifies search matches from two batched reads. The discovery overlap can
 * contain many rows on a busy workspace; sending those through `applyPage`
 * would repeat its per-message reads and topic indexing even when every row
 * is already current.
 */
const changedSearchMatches = (
  ctx: SyncContext,
  byChannel: ReadonlyMap<string, ReadonlyArray<Message>>,
  requestedAt: Ts,
): Effect.Effect<Map<string, Array<Message>>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const entries = [...byChannel].flatMap(([channel, messages]) => messages.map((message) => ({ channel, message })))
    if (entries.length === 0) return new Map()
    const channels = [...new Set(entries.map(({ channel }) => channel))]
    const roots = [...new Set(entries.flatMap(({ message }) => (isReply(message) && message.thread_ts !== undefined ? [message.thread_ts] : [])))]
    const timestamps = [...new Set(entries.flatMap(({ message }) => [message.ts, ...(isReply(message) && message.thread_ts !== undefined ? [message.thread_ts] : [])]))]
    const stored = yield* sql<MessageRow>`SELECT * FROM messages WHERE channel IN ${sql.in(channels)} AND ts IN ${sql.in(timestamps)}`
    const counts = roots.length === 0
      ? []
      : yield* sql<{ channel: string; thread_ts: string; n: number }>`
          SELECT channel, thread_ts, count(*) AS n FROM messages
          WHERE channel IN ${sql.in(channels)} AND thread_ts IN ${sql.in(roots)} AND ts <> thread_ts AND deleted = 0
          GROUP BY channel, thread_ts`
    const rows = new Map(stored.map((row) => [`${row.channel}:${row.ts}`, row]))
    const replyCounts = new Map(counts.map((row) => [`${row.channel}:${row.thread_ts}`, row.n]))
    const source = { kind: 'partial', requestedAt } as const
    const changed = new Map<string, Array<Message>>()
    for (const { channel, message } of entries) {
      const key = `${channel}:${message.ts}`
      let differs = ctx.lateReactions.has(key) || mergeMessage(rows.get(key), message, channel, source).changed
      if (!differs && isReply(message) && message.thread_ts !== undefined) {
        const rootKey = `${channel}:${message.thread_ts}`
        const root = rows.get(rootKey)
        differs = root === undefined ||
          mergeRootCounters(root, { reply_count: replyCounts.get(rootKey) ?? 0, latest_reply: message.ts }, source).changed ||
          root.latest_reply === null || compareTs(message.ts, root.latest_reply) > 0
      }
      if (!differs) continue
      const messages = changed.get(channel) ?? []
      messages.push(message)
      changed.set(channel, messages)
    }
    return changed
  })

/**
 * Newest-first search pages from member conversations, each applied as a
 * partial page, until a page reaches `sinceMillis`, the last page, or
 * `pages`. On the background lane, which paces search on its own clock.
 */
const searchPages = (ctx: SyncContext, pass: SearchPass, options: DiscoverOptions): Effect.Effect<void, SlackApiError | SqlError, Services> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const sql = yield* StoreWriter
    const members = new Set((yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1`).map((r) => r.id))
    const sinceTs = `${Math.floor(pass.sinceMillis / 1000)}.000000`
    for (let page = 1; page <= pass.pages; page++) {
      const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
      const answer = yield* api.call(
        'search.modules.messages',
        { module: 'messages', query: pass.query, count: ctx.config.searchPageCount, page, no_user_profile: 1, extra_message_data: 1, sort: 'timestamp', sort_dir: 'desc' },
        { lane: 'background', reason: pass.reason },
      )
      const matches = searchMatches(answer)
      const byChannel = new Map<string, Array<Message>>()
      let reachedSince = false
      for (const match of matches) {
        if (match.ts < sinceTs) {
          reachedSince = true
          continue
        }
        const channel = searchMatchChannelId(match)
        if (!members.has(channel)) continue
        const message = pass.toMessage(match)
        if (message === undefined) continue
        let list = byChannel.get(channel)
        if (list === undefined) {
          list = []
          byChannel.set(channel, list)
        }
        list.push(message)
      }
      const selected = pass.certifyStored === true ? yield* changedSearchMatches(ctx, byChannel, requestedAt) : byChannel
      if (pass.nameFirst === true) yield* nameFirst(ctx, [...selected.values()].flat(), 'background')
      for (const [channel, matched] of selected) {
        const messages = pass.select === undefined ? matched : [...(yield* pass.select(channel, matched))]
        if (messages.length === 0) continue
        // Search is newest first. Store roots before replies on this page, so
        // their counters prevent a redundant stub/root lookup for each reply.
        messages.sort((a, b) => Number(isReply(a)) - Number(isReply(b)))
        yield* applyPage(ctx, channel, messages, { kind: 'partial', requestedAt }, options.seedReadBefore === undefined ? {} : { seedReadBefore: options.seedReadBefore })
      }
      const pageCount = answer.pagination?.page_count ?? answer.messages?.pagination?.page_count
      const next = answer.response_metadata?.next_cursor
      const hasMore = (pageCount !== undefined && page < pageCount) || (next !== undefined && next !== '')
      if (reachedSince || !hasMore || matches.length === 0) return
      yield* Effect.yieldNow
    }
  })

/** Thread activity since `sinceMillis`, by search. */
const discoverBySearch = (ctx: SyncContext, sinceMillis: number, options: DiscoverOptions): Effect.Effect<void, SlackApiError | SqlError, Services> =>
  searchPages(ctx, {
    query: `is:thread after:${afterDate(sinceMillis - DISCOVERY_OVERLAP_MILLIS)}`,
    pages: ctx.config.searchMaxPages,
    sinceMillis: sinceMillis - DISCOVERY_OVERLAP_MILLIS,
    reason: 'discovery',
    toMessage: matchToMessage,
    certifyStored: true,
  }, options)

/**
 * A match that Main shows, as a message: a plain message or a thread root
 * by a person. Replies are left to discovery, which would fetch every
 * unknown root; bot posts are left to history, since a match carries no
 * bot fields and the row would have no sender.
 */
const matchToMainMessage = (match: FlatSearchMatch, sinceTs: string): Message | undefined => {
  if (match.user === undefined || match.ts < sinceTs) return undefined
  const threadTs = threadTsOf(match)
  return threadTs === undefined || threadTs === match.ts ? toMessage(match, threadTs) : undefined
}

/**
 * What a preview may store: nothing for a conversation whose history has
 * landed (its rows already show it), and only posts by people the store
 * knows. A bot's match carries no bot fields, so its channel would show as
 * a person's until history sorts it into Automated.
 */
const previewsToStore = (channel: string, messages: ReadonlyArray<Message>): Effect.Effect<ReadonlyArray<Message>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if ((yield* sql<{ n: number }>`SELECT count(*) AS n FROM synced_ranges WHERE channel = ${channel}`)[0]?.n) return []
    const ids = [...new Set(messages.flatMap((m) => (m.user === undefined ? [] : [m.user])))]
    if (ids.length === 0) return []
    const people = new Set((yield* sql<{ id: string }>`SELECT id FROM users WHERE is_bot = 0 AND id IN ${sql.in(ids)}`).map((r) => r.id))
    return messages.filter((m) => m.user !== undefined && people.has(m.user))
  })

/**
 * The cold boot's preview search: the newest messages of the workspace
 * since `sinceMillis`, at most `SyncConfig.previewSearchPages` pages, so the
 * most active channels and DMs show a preview seconds after the quick
 * start instead of when their history page lands. Each match is partial:
 * the history page that follows replaces it with the full message. A match
 * older than `sinceMillis` (`after:` names the day before) is dropped, so no
 * conversation outside the window gets a row.
 */
export const searchPreviews = (ctx: SyncContext, sinceMillis: number, options: DiscoverOptions): Effect.Effect<void, SlackApiError | SqlError, Services> => {
  const sinceTs = `${Math.floor(sinceMillis / 1000)}.000000`
  return searchPages(
    ctx,
    {
      query: `after:${afterDate(sinceMillis)}`,
      pages: ctx.config.previewSearchPages,
      sinceMillis,
      reason: 'previews',
      toMessage: (match) => matchToMainMessage(match, sinceTs),
      nameFirst: true,
      select: previewsToStore,
    },
    options,
  )
}

/** The fallback: replies since the stored ones for every root whose `latest_reply` moved. */
const discoverByReplies = (ctx: SyncContext, options: DiscoverOptions): Effect.Effect<void, SlackApiError | SqlError, Services> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const sql = yield* StoreWriter
    const roots = yield* sql<{ channel: string; ts: string; latest_reply: string; last_stored: string | null }>`
      SELECT m.channel, m.ts, m.latest_reply,
        (SELECT max(r.ts) FROM messages r WHERE r.channel = m.channel AND r.thread_ts = m.ts AND r.ts <> m.ts) AS last_stored
      FROM messages m JOIN conversations c ON c.id = m.channel
      WHERE m.reply_count > 0 AND m.latest_reply IS NOT NULL AND c.is_member = 1`
    for (const root of roots) {
      if (root.last_stored !== null && root.last_stored >= root.latest_reply) continue
      const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
      const page = yield* api
        .call(
          'conversations.replies',
          { channel: root.channel, ts: root.ts as Ts, oldest: root.last_stored ?? root.ts, inclusive: false, limit: ctx.config.historyPageLimit },
          { lane: 'background', reason: 'replies-since' },
        )
        .pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
      if (page === undefined) continue
      yield* applyPage(ctx, root.channel, page.messages, { kind: 'page', requestedAt }, options.seedReadBefore === undefined ? {} : { seedReadBefore: options.seedReadBefore })
      yield* Effect.yieldNow
    }
  })

/**
 * The discovery sweep for the gap since `sinceMillis`. `counts` is the
 * latest `client.counts`, already applied by the caller; the fallback does
 * not need it because the catch-up has fetched history where `latest` moved.
 */
export const discoverSince = (
  ctx: SyncContext,
  sinceMillis: number,
  _counts: ReadonlyArray<CountEntry>,
  options: DiscoverOptions,
): Effect.Effect<void, SlackApiError | SqlError, Services> =>
  ctx.config.discovery === 'search' ? discoverBySearch(ctx, sinceMillis, options) : discoverByReplies(ctx, options)
