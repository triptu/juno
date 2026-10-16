/**
 * Applying a page of messages to the store: one transaction per page, every
 * message through the merge rules, reactions behind their guard, stub roots
 * for replies whose root is unknown, and `reindexTopics` for every topic the
 * page touched. History, replies, thread views and search matches all land
 * here; the socket events have their own path in `events.ts` but use the
 * same merge.
 */
import { compareTs, mainTopicId, threadTopicId, tsToMillis, type ChannelId, type Ts } from '@juno/domain'
import { isReply, type Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { imagesWithoutThumbs } from './files'
import { reindexOptions, wantUsers, type SyncContext } from './context'
import { mergeMessage, mergeRootCounters, stubRoot, type MergeSource } from './merge'
import { reindexTopics, topicsOfMessages } from './reindex'
import { referencedUserIds } from './users'
import { applyRootSubscription, markRepliesComplete, observeRead, readMessage, replaceReactions, seedTopicRead, writeMessage } from './write'

/** Images older than this that arrive without thumbnails are not asked about again: Slack would have made them. */
const THUMBS_WAIT_MILLIS = 24 * 60 * 60_000

/** Merges one message and returns the rows it produced (the message, and a stub root when needed). */
export const mergeOne = (
  ctx: SyncContext,
  channel: string,
  message: Message,
  source: MergeSource,
): Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const existing = yield* readMessage(channel, message.ts)
    const merged = mergeMessage(existing, message, channel, source)
    const touched: Array<MessageRow> = [merged.row]
    if (merged.changed) {
      yield* writeMessage(merged.row)
      // Everyone the message shows gets a name as soon as possible; `nameUsers` skips the ones the store has.
      wantUsers(ctx, referencedUserIds([message]))
      // A recent image without thumbnails: Slack is likely still making them (`files.ts`).
      const waiting = imagesWithoutThumbs(merged.row.files_json)
      if (waiting.length > 0 && tsToMillis(message.ts as Ts) > (yield* Clock.currentTimeMillis) - THUMBS_WAIT_MILLIS) {
        for (const fileId of waiting) yield* Queue.offer(ctx.fileFetches, { kind: 'stored', fileId, channel, ts: message.ts })
      }
    }
    if (merged.applyReactions) yield* replaceReactions(merged.row, message.reactions ?? [], ctx.me.userId)
    // A reaction event came before this message was stored; a page requested before it does not have it.
    if (source.kind !== 'event') {
      const key = `${channel}:${message.ts}`
      const lateAt = ctx.lateReactions.get(key)
      if (lateAt !== undefined) {
        ctx.lateReactions.delete(key)
        if (compareTs(lateAt, source.requestedAt) >= 0) yield* Queue.offer(ctx.rootFetches, { channel, ts: message.ts })
      }
    }
    // A root on a page says whether the user follows its thread and, when followed, Slack's read pointer
    // (research section 3). Events say so with their own frames. A thread older than the window becomes a
    // row this way as soon as its root is fetched.
    if (source.kind !== 'event' && !isReply(message) && message.subscribed !== undefined) {
      yield* applyRootSubscription(channel, message, source.requestedAt)
      if (message.subscribed && message.last_read !== undefined) {
        const topic = threadTopicOf(channel, message.ts)
        const read = { kind: 'page', lastReadTs: message.last_read, requestedAt: source.requestedAt as Ts } as const
        // An event Juno cannot order, or a page too old to apply that disagrees: ask for the root again (specs/readstate.qnt).
        if ((yield* observeRead(topic, read)) === 'lookup') yield* Queue.offer(ctx.rootFetches, { channel, ts: message.ts })
      }
    }

    // A reply keeps its root's counters current and creates a stub root when the root is unknown.
    if (isReply(message) && message.thread_ts !== undefined) {
      const root = yield* readMessage(channel, message.thread_ts)
      if (root === undefined) {
        const stub = stubRoot(channel, message.thread_ts, message)
        yield* writeMessage(stub)
        yield* Queue.offer(ctx.rootFetches, { channel, ts: message.thread_ts })
        touched.push(stub)
      } else {
        // The root has at least as many replies as the store holds; a page may bring one the counters never saw.
        const sql = yield* StoreWriter
        const stored = yield* sql<{ n: number }>`
          SELECT count(*) AS n FROM messages WHERE channel = ${channel} AND thread_ts = ${message.thread_ts} AND ts <> ${message.thread_ts} AND deleted = 0`
        const counters = mergeRootCounters(root, { reply_count: stored[0]?.n ?? 0, latest_reply: message.ts }, source)
        if (counters.changed) yield* writeMessage(counters.row)
        touched.push(counters.row)
        // A reply from a page that the root's counters never saw (no `message_replied` reached us):
        // fetch the root again so `reply_count` is Slack's, not a lower bound.
        const stale = root.latest_reply === null || compareTs(message.ts, root.latest_reply) > 0
        if (source.kind !== 'event' && stale && !isStub(root)) yield* Queue.offer(ctx.rootFetches, { channel, ts: root.ts })
      }
    }
    return touched
  })

export interface ApplyPageOptions {
  /** Topics to re-index as well, such as Main for a history page that brought nothing. */
  readonly alsoTouch?: Iterable<string>
  /**
   * Cold boot only: a thread first seen here that the user does not follow
   * starts read as of this moment (the cold boot's start), so a first boot
   * does not light up every old thread, while a reply that arrives during
   * the boot stays unread. Later discoveries start unread.
   */
  readonly seedReadBefore?: string
}

/** Applies a page in one transaction and re-indexes what it touched. Returns the touched topic ids. */
export const applyPage = (
  ctx: SyncContext,
  channel: string,
  messages: ReadonlyArray<Message>,
  source: MergeSource,
  options: ApplyPageOptions = {},
): Effect.Effect<ReadonlySet<string>, SqlError, StoreWriter | Invalidation> =>
  transaction(
    Effect.gen(function* () {
      const rows: Array<MessageRow> = []
      for (const message of messages) rows.push(...(yield* mergeOne(ctx, channel, message, source)))
      const topics = topicsOfMessages(rows)
      for (const id of options.alsoTouch ?? []) topics.add(id)
      if (options.seedReadBefore !== undefined) yield* seedThreadsRead(rows, options.seedReadBefore)
      yield* reindexTopics(topics, reindexOptions(ctx))
      return topics
    }),
  )

/**
 * Roots in `rows` whose thread has no read pointer yet start read at their
 * latest reply before `before` (`ApplyPageOptions.seedReadBefore`); a reply
 * after it, which can only have come by event, stays unread. From the
 * pointer on every reply arrives as an event, so coverage is complete from
 * that point.
 */
const seedThreadsRead = (rows: ReadonlyArray<MessageRow>, before: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const row of rows) {
      const isRoot = row.thread_ts === null || row.thread_ts === row.ts
      if (!isRoot || row.reply_count === 0) continue
      const topic = threadTopicOf(row.channel, row.ts)
      const existing = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topic}`
      if (existing.length > 0) continue
      const latest = row.latest_reply ?? row.ts
      const from = compareTs(latest, before) > 0 ? before : latest
      yield* seedTopicRead(topic, from)
      yield* markRepliesComplete(row.channel, row.ts, false, 0, from)
    }
  })

/** A root the store only knows from one of its replies; its fetch is already queued. */
const isStub = (row: MessageRow): boolean => row.user_id === null && row.text === '' && row.blocks_json === null

/** The thread topic a root or reply belongs to. */
export const threadTopicOf = (channel: string, threadTs: string): string => threadTopicId(channel as ChannelId, threadTs as Ts)
export const mainTopicOf = (channel: string): string => mainTopicId(channel as ChannelId)
