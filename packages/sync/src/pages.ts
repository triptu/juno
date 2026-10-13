/**
 * Applying a page of messages to the store: one transaction per page, every
 * message through the merge rules, reactions behind their guard, stub roots
 * for replies whose root is unknown, and `reindexTopics` for every topic the
 * page touched. History, replies, thread views and search matches all land
 * here; the socket events have their own path in `events.ts` but use the
 * same merge.
 */
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { isReply, type Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { mergeMessage, mergeRootCounters, stubRoot, type MergeSource } from './merge'
import { reindexTopics, topicsOfMessages } from './reindex'
import { markRepliesComplete, readMessage, replaceReactions, seedTopicRead, writeMessage } from './write'

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

    // A reply keeps its root's counters current and creates a stub root when the root is unknown.
    if (isReply(message) && message.thread_ts !== undefined) {
      const root = yield* readMessage(channel, message.thread_ts)
      if (root === undefined) {
        const stub = stubRoot(channel, message.thread_ts, message)
        yield* writeMessage(stub)
        yield* Queue.offer(ctx.rootFetches, { channel, ts: message.thread_ts })
        touched.push(stub)
      } else {
        const counters = mergeRootCounters(root, { reply_count: 0, latest_reply: message.ts }, source)
        if (counters.changed) yield* writeMessage(counters.row)
        touched.push(counters.row)
      }
    }
    return touched
  })

/** Applies a page in one transaction and re-indexes what it touched. Returns the touched topic ids. */
export const applyPage = (
  ctx: SyncContext,
  channel: string,
  messages: ReadonlyArray<Message>,
  source: MergeSource,
  alsoTouch: Iterable<string> = [],
): Effect.Effect<ReadonlySet<string>, SqlError, StoreWriter | Invalidation> =>
  transaction(
    Effect.gen(function* () {
      const rows: Array<MessageRow> = []
      for (const message of messages) rows.push(...(yield* mergeOne(ctx, channel, message, source)))
      const topics = topicsOfMessages(rows)
      for (const id of alsoTouch) topics.add(id)
      if (ctx.seedNewThreadsAsRead) yield* seedThreadsRead(rows)
      yield* reindexTopics(topics, reindexOptions(ctx))
      return topics
    }),
  )

/**
 * Roots in `rows` whose thread has no read pointer yet start read at their
 * latest reply (see `SyncContext`); from there on every reply arrives as an
 * event, so coverage is complete from that point.
 */
const seedThreadsRead = (rows: ReadonlyArray<MessageRow>): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const row of rows) {
      const isRoot = row.thread_ts === null || row.thread_ts === row.ts
      if (!isRoot || row.reply_count === 0) continue
      const topic = threadTopicOf(row.channel, row.ts)
      const existing = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topic}`
      if (existing.length > 0) continue
      const from = row.latest_reply ?? row.ts
      yield* seedTopicRead(topic, from)
      yield* markRepliesComplete(row.channel, row.ts, false, 0, from)
    }
  })

/** The thread topic a root or reply belongs to. */
export const threadTopicOf = (channel: string, threadTs: string): string => threadTopicId(channel as ChannelId, threadTs as Ts)
export const mainTopicOf = (channel: string): string => mainTopicId(channel as ChannelId)
