/**
 * Applying a page of messages to the store: one transaction per page, every
 * message through the merge rules, reactions behind their guard, stub roots
 * for replies whose root is unknown, and `reindexTopics` for every topic the
 * page touched. History, replies, thread views and search matches all land
 * here; the socket events have their own path in `events.ts` but use the
 * same merge.
 */
import { compareTs, mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { isReply, type Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { mergeMessage, mergeRootCounters, stubRoot, type MergeSource } from './merge'
import { reindexTopics, topicsOfMessages } from './reindex'
import { applyRootSubscription, applyServerMark, markRepliesComplete, readMessage, replaceReactions, seedTopicRead, writeMessage } from './write'

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
    if (merged.changed) yield* writeMessage(merged.row)
    if (merged.applyReactions) yield* replaceReactions(channel, message.ts, message.reactions ?? [], ctx.me.userId)
    // A root on a page says whether the user follows its thread and, when followed, Slack's read pointer
    // (research section 3). Events say so with their own frames. A thread older than the window becomes a
    // row this way as soon as its root is fetched.
    if (source.kind !== 'event' && !isReply(message) && message.subscribed !== undefined) {
      yield* applyRootSubscription(channel, message, source.requestedAt)
      if (message.subscribed && message.last_read !== undefined) {
        const topic = threadTopicOf(channel, message.ts)
        yield* seedTopicRead(topic, message.last_read)
        yield* applyServerMark(topic, message.last_read, source.requestedAt)
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
   * Cold boot history only: a thread discovered through history that the
   * user does not follow starts read at its latest reply, so a first boot
   * does not light up every old thread. Later discoveries start unread.
   */
  readonly seedThreadsRead?: boolean
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
      if (options.seedThreadsRead === true && source.kind !== 'event') yield* seedThreadsRead(rows, source.requestedAt)
      yield* reindexTopics(topics, reindexOptions(ctx))
      return topics
    }),
  )

/**
 * Roots in `rows` whose thread has no read pointer yet start read at their
 * latest reply as of the page request (`ApplyPageOptions.seedThreadsRead`):
 * a reply that reached the store by event while the page was in flight is
 * newer than `requestedAt` and stays unread. From the pointer on every reply
 * arrives as an event, so coverage is complete from that point.
 */
const seedThreadsRead = (rows: ReadonlyArray<MessageRow>, requestedAt: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const row of rows) {
      const isRoot = row.thread_ts === null || row.thread_ts === row.ts
      if (!isRoot || row.reply_count === 0) continue
      const topic = threadTopicOf(row.channel, row.ts)
      const existing = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topic}`
      if (existing.length > 0) continue
      const latest = row.latest_reply ?? row.ts
      const from = compareTs(latest, requestedAt) > 0 ? yield* latestReplyBefore(row.channel, row.ts, requestedAt) : latest
      yield* seedTopicRead(topic, from)
      yield* markRepliesComplete(row.channel, row.ts, false, 0, from)
    }
  })

/** The newest stored reply of a thread older than `before`, else the root. */
const latestReplyBefore = (channel: string, rootTs: string, before: string): Effect.Effect<string, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ ts: string }>`
      SELECT ts FROM messages WHERE channel = ${channel} AND thread_ts = ${rootTs} AND ts <> ${rootTs} AND ts < ${before}
      ORDER BY ts DESC LIMIT 1`
    return rows[0]?.ts ?? rootTs
  })

/** A root the store only knows from one of its replies; its fetch is already queued. */
const isStub = (row: MessageRow): boolean => row.user_id === null && row.text === '' && row.blocks_json === null

/** The thread topic a root or reply belongs to. */
export const threadTopicOf = (channel: string, threadTs: string): string => threadTopicId(channel as ChannelId, threadTs as Ts)
export const mainTopicOf = (channel: string): string => mainTopicId(channel as ChannelId)
