import { millisToTs, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import type { Channel, ClientCountsArgs, CountEntry, ThreadCounts } from '@juno/slack-schema'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { readMetadata, storeMembership, storeMetadata } from './metadata'
import { mainTopicOf } from './pages'
import { reindexTopics } from './reindex'
import {
  observeRead,
  setChannelReads,
  toConversationRow,
} from './write'

import type { BootError, BootServices } from './boot'

/**
 * `client.counts`: which conversations the user is in, Slack's read pointers
 * and unread flags for each, and the first read pointer of every Main.
 * Without `counts_last_fetched` the list is complete and membership is
 * replaced by it; with it the entries only add members (what the server
 * leaves out of an incremental answer is Unknown, research section 2). An
 * entry for a conversation the store has never seen (joined while the
 * socket was down) is fetched with `conversations.info` first, so the
 * membership write has a row to land on.
 */
export const loadCounts = (ctx: SyncContext, sinceFetched: number | undefined, lane: 'interactive' | 'background' = 'interactive'): Effect.Effect<Counts, BootError, BootServices> =>
  readMetadata(ctx.metadata, (observed) => Effect.gen(function* () {
    const api = yield* SlackApi
    const args: ClientCountsArgs = { thread_counts_by_channel: true, ...(sinceFetched === undefined ? {} : { counts_last_fetched: sinceFetched }) }
    // The time before the call: a `*_marked` event that lands while counts is in flight is newer than the answer.
    const now = yield* Clock.currentTimeMillis
    const requestedAt = millisToTs(now)
    const counts = yield* api.call('client.counts', args, { lane, reason: 'counts' })
    const entries = [...counts.channels, ...counts.ims, ...counts.mpims]
    const unknown = yield* unknownConversations(entries.map((e) => e.id))
    const fetched: Array<Channel> = []
    for (const id of unknown) {
      const info = yield* api.call('conversations.info', { channel: id }, { lane, reason: 'conversation' }).pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
      if (info !== undefined) fetched.push(info.channel)
    }
    yield* transaction(
      Effect.gen(function* () {
        const ids = entries.map((e) => e.id)
        if (fetched.length > 0) yield* storeMetadata(observed, fetched.map((c) => toConversationRow(c)))
        yield* storeMembership(observed, ids, sinceFetched === undefined)
        yield* setChannelReads(entries, now)
        // A pointer Juno has never seen is Slack's; a known one applies when Slack's changed (specs/readstate.qnt).
        for (const entry of entries) {
          const outcome = yield* observeRead(mainTopicOf(entry.id), { kind: 'page', lastReadTs: entry.last_read, requestedAt })
          if (outcome === 'applied') yield* reindexTopics([mainTopicOf(entry.id)], reindexOptions(ctx))
          if (outcome === 'lookup') yield* Queue.offer(ctx.readLookups, entry.id)
        }
      }),
    )
    return { entries, fetched: counts.counts_last_fetched, threads: counts.threads }
  }))

export interface Counts {
  readonly entries: ReadonlyArray<CountEntry>
  readonly fetched: number | undefined
  /** Followed threads with unread replies and mentions, by channel. */
  readonly threads: ThreadCounts
}

/** Ids among `ids` with no `conversations` row. */
const unknownConversations = (ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (ids.length === 0) return []
    const sql = yield* StoreWriter
    const known = new Set<string>()
    for (let i = 0; i < ids.length; i += 500) {
      const rows = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id IN ${sql.in(ids.slice(i, i + 500))}`
      for (const row of rows) known.add(row.id)
    }
    return ids.filter((id) => !known.has(id))
  })

interface Active {
  readonly id: string
  readonly latest: Ts
}

/**
 * The cold boot's history order. Each page makes its conversation's unread
 * count exact, so the conversations whose counts a user reads first go
 * first (10-18): DMs and group DMs with unread messages, then channels with
 * an unread mention of the user (in Main or a followed thread), then the
 * other unread channels. After them the owner's order of 10-16 for the
 * rest: the read DMs and group DMs, then channels with unread replies in a
 * followed thread, then the ones where the store already holds the user's
 * own messages (most first), then the rest. Newest first within each tier.
 * Order only: every conversation is still read once.
 */
export const historyOrder = (ctx: SyncContext, active: ReadonlyArray<Active>, counts: Counts): Effect.Effect<ReadonlyArray<Active>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (active.length === 0) return active
    const sql = yield* StoreWriter
    const ids = active.map((conversation) => conversation.id)
    const kinds = new Map((yield* sql<{ id: string; kind: string }>`SELECT id, kind FROM conversations WHERE id IN ${sql.in(ids)}`).map((row) => [row.id, row.kind]))
    const own = new Map((yield* sql<{ channel: string; n: number }>`
      SELECT channel, count(*) AS n FROM messages WHERE user_id = ${ctx.me.userId} AND deleted = 0 GROUP BY channel`).map((row) => [row.channel, row.n]))
    const entries = new Map(counts.entries.map((entry) => [entry.id, entry]))
    const tier = (id: string): number => {
      const kind = kinds.get(id)
      const entry = entries.get(id)
      const unread = entry?.has_unreads === true
      if (kind === 'im' || kind === 'mpim') return unread ? 0 : 3
      if ((unread && entry.mention_count > 0) || (counts.threads.mention_count_by_channel?.[id] ?? 0) > 0) return 1
      if (unread) return 2
      if ((counts.threads.unread_count_by_channel?.[id] ?? 0) > 0) return 4
      return own.has(id) ? 5 : 6
    }
    // A stable sort: `active` is newest first, and stays so within a tier.
    return active.toSorted((a, b) => tier(a.id) - tier(b.id) || (tier(a.id) === 5 ? (own.get(b.id) ?? 0) - (own.get(a.id) ?? 0) : 0))
  })

/** Member conversations with activity inside the window, newest first. */
export const activeConversations = (entries: ReadonlyArray<CountEntry>, start: Ts): Effect.Effect<ReadonlyArray<Active>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const members = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1 AND is_archived = 0`
    const memberIds = new Set(members.map((m) => m.id))
    return entries
      .filter((e): e is CountEntry & { latest: Ts } => typeof e.latest === 'string' && memberIds.has(e.id) && e.latest >= start)
      .map((e) => ({ id: e.id, latest: e.latest }))
      .toSorted((a, b) => (a.latest > b.latest ? -1 : a.latest < b.latest ? 1 : 0))
  })
