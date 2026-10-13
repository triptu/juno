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
 * no files and no reactions). An unknown root becomes a stub and is fetched.
 * A match that says nothing about its thread (no `thread_ts`, not in the
 * permalink, no `reply_count`) is dropped.
 *
 * Fallback (`discovery: 'history'`): history since the synced range for
 * conversations whose `latest` moved (the catch-up already did that), plus
 * `conversations.replies` since the stored replies for roots whose
 * `latest_reply` moved. It leaves the gap for unfollowed old roots.
 *
 * Against the fake, search is honoured as documented; whether a real `xoxc`
 * session honours `is:thread` is still to be confirmed by the live smoke.
 */
import { millisToTs, type Ts } from '@juno/domain'
import { SlackApi, type SlackApiError } from '@juno/slack'
import { searchMatchChannelId, searchMatches, type CountEntry, type FlatSearchMatch, type Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { SyncContext } from './context'
import { applyPage } from './pages'

type Services = SlackApi | StoreWriter | Invalidation

const DAY = 24 * 60 * 60 * 1000

/** `after:` takes a date; the day before `since` keeps every message since that moment in the result. */
const afterDate = (sinceMillis: number): string => new Date(sinceMillis - DAY).toISOString().slice(0, 10)

/** The thread a match belongs to: its `thread_ts`, else the `thread_ts` query parameter of its permalink. */
const threadTsOf = (match: FlatSearchMatch): Ts | undefined => {
  if (match.thread_ts !== undefined) return match.thread_ts
  if (match.permalink === undefined) return undefined
  const value = /[?&]thread_ts=(\d+\.\d+)/.exec(match.permalink)?.[1]
  return value === undefined ? undefined : (value as Ts)
}

/** A match as a message, or `undefined` when it says nothing about a thread. */
const matchToMessage = (match: FlatSearchMatch): Message | undefined => {
  const threadTs = threadTsOf(match)
  if (threadTs === undefined && (match.reply_count ?? 0) === 0) return undefined
  return {
    type: 'message',
    ts: match.ts,
    ...(match.user === undefined ? {} : { user: match.user }),
    ...(match.text === undefined ? {} : { text: match.text }),
    ...(match.blocks === undefined ? {} : { blocks: match.blocks }),
    ...(match.attachments === undefined ? {} : { attachments: match.attachments }),
    ...(match.files === undefined ? {} : { files: match.files }),
    ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
    ...(match.reply_count === undefined ? {} : { reply_count: match.reply_count }),
  }
}

export interface DiscoverOptions {
  /** Cold boot: a thread first seen here that the user does not follow starts read as of this ts (see `ApplyPageOptions`). */
  readonly seedReadBefore?: string
}

/** Thread activity since `sinceMillis`, by search. */
const discoverBySearch = (ctx: SyncContext, sinceMillis: number, options: DiscoverOptions): Effect.Effect<void, SlackApiError | SqlError, Services> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const sql = yield* StoreWriter
    const members = new Set((yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1`).map((r) => r.id))
    const sinceTs = `${Math.floor(sinceMillis / 1000)}.000000`
    const query = `is:thread after:${afterDate(sinceMillis)}`
    for (let page = 1; page <= ctx.config.searchMaxPages; page++) {
      const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
      const answer = yield* api.call(
        'search.modules.messages',
        { module: 'messages', query, count: ctx.config.searchPageCount, page, no_user_profile: 1, sort: 'timestamp', sort_dir: 'desc' },
        { lane: 'background', reason: 'discovery' },
      )
      const matches = searchMatches(answer)
      const byChannel = new Map<string, Array<Message>>()
      let reachedSince = false
      for (const match of matches) {
        if (match.ts < sinceTs) reachedSince = true
        const channel = searchMatchChannelId(match)
        if (!members.has(channel)) continue
        const message = matchToMessage(match)
        if (message === undefined) continue
        let list = byChannel.get(channel)
        if (list === undefined) {
          list = []
          byChannel.set(channel, list)
        }
        list.push(message)
      }
      for (const [channel, messages] of byChannel) yield* applyPage(ctx, channel, messages, { kind: 'partial', requestedAt }, options.seedReadBefore === undefined ? {} : { seedReadBefore: options.seedReadBefore })
      const pageCount = answer.pagination?.page_count ?? answer.messages?.pagination?.page_count
      const next = answer.response_metadata?.next_cursor
      const hasMore = (pageCount !== undefined && page < pageCount) || (next !== undefined && next !== '')
      if (reachedSince || !hasMore || matches.length === 0) return
      yield* Effect.yieldNow
    }
  })

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
