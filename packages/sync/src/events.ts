/**
 * Socket events into the store (architecture section 6). Each event is one
 * writer transaction; keys invalidated inside fire once after the commit,
 * and `reindexTopics` runs for the topics the event touched.
 */
import { compareTs, millisToTs, type Ts } from '@juno/domain'
import {
  isMessageChanged,
  isMessageDeleted,
  isMessagePosted,
  isMessageReplied,
  type Message,
  type RtmFrame,
} from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { mergeRootCounters, mergeTombstone } from './merge'
import { mainTopicOf, mergeOne, threadTopicOf } from './pages'
import { reindexTopics, topicsOfMessages } from './reindex'
import {
  applyServerMark,
  changeReaction,
  patchConversation,
  readMessage,
  reopenIfResolved,
  setChannelReads,
  setPref,
  setThreadSub,
  threadMessages,
  threadSub,
  toConversationRow,
  topicOfMessage,
  upsertConversations,
  upsertUsers,
  writeMessage,
  type ThreadSubSource,
} from './write'

type Services = StoreWriter | Invalidation

const LATE_REACTIONS_MAX = 1000

/** A reaction to a message the store does not have yet; see `SyncContext.lateReactions`. */
const noteLateReaction = (ctx: SyncContext, channel: string, ts: string, eventTs: string): Effect.Effect<void> =>
  Effect.sync(() => {
    const key = `${channel}:${ts}`
    ctx.lateReactions.delete(key)
    ctx.lateReactions.set(key, eventTs)
    if (ctx.lateReactions.size > LATE_REACTIONS_MAX) ctx.lateReactions.delete(ctx.lateReactions.keys().next().value!)
  })

const eventTsOf = (frame: { readonly event_ts?: Ts; readonly ts?: Ts }, now: number): string =>
  frame.event_ts ?? frame.ts ?? `${Math.floor(now / 1000)}.000000`

/** Applies one decoded frame. Frames that carry nothing for the store are ignored. */
export const applyFrame = (ctx: SyncContext, frame: RtmFrame): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    switch (frame.type) {
      case 'message':
        return yield* applyMessageFrame(ctx, frame, now)
      case 'channel_marked':
      case 'group_marked':
      case 'im_marked':
      case 'mpim_marked':
        return yield* transaction(
          Effect.gen(function* () {
            const topic = mainTopicOf(frame.channel)
            yield* applyServerMark(topic, frame.ts, eventTsOf(frame, now))
            const sql = yield* StoreWriter
            const rows = yield* sql<{ latest: string | null }>`SELECT latest FROM channel_reads WHERE channel = ${frame.channel}`
            const unread = frame.unread_count ?? frame.unread_count_display
            yield* setChannelReads(
              [
                {
                  id: frame.channel,
                  last_read: frame.ts,
                  latest: (rows[0]?.latest ?? null) as Ts | null,
                  has_unreads: unread === undefined ? false : unread > 0,
                  mention_count: frame.mention_count ?? frame.num_mentions ?? 0,
                },
              ],
              now,
            )
            yield* reindexTopics([topic], reindexOptions(ctx))
          }),
        )
      case 'thread_marked':
      case 'thread_subscribed':
      case 'thread_unsubscribed':
        // An event without `event_ts` has no place in the order: ask Slack for the root instead (specs/follow.qnt).
        if (frame.event_ts === undefined) return yield* Queue.offer(ctx.rootFetches, { channel: frame.subscription.channel, ts: frame.subscription.thread_ts })
        return yield* transaction(
          Effect.gen(function* () {
            const sub = frame.subscription
            const eventTs = frame.event_ts as string
            // `thread_marked` says whether the thread is followed only when it carries `active`.
            const subscribed = frame.type === 'thread_unsubscribed' ? false : frame.type === 'thread_subscribed' ? (sub.active ?? true) : sub.active
            const source = { kind: 'event', eventTs, observedAt: millisToTs(now) } as const
            if (subscribed !== undefined) yield* setThreadSub(sub.channel, sub.thread_ts, subscribed, sub.last_read, source)
            const topic = threadTopicOf(sub.channel, sub.thread_ts)
            if (sub.last_read !== undefined) yield* applyServerMark(topic, sub.last_read, eventTs)
            yield* reindexTopics([topic], reindexOptions(ctx))
          }),
        )
      case 'reaction_added':
      case 'reaction_removed': {
        if (frame.item.type !== 'message') return
        const { channel, ts } = frame.item
        return yield* transaction(
          Effect.gen(function* () {
            const existing = yield* readMessage(channel, ts)
            if (existing === undefined) return yield* noteLateReaction(ctx, channel, ts, frame.event_ts)
            yield* changeReaction(channel, ts, frame.reaction, frame.user, frame.type === 'reaction_added', ctx.me.userId)
            const last = existing.last_event_ts === null ? frame.event_ts : compareTs(frame.event_ts, existing.last_event_ts) > 0 ? frame.event_ts : existing.last_event_ts
            if (last !== existing.last_event_ts) yield* writeMessage({ ...existing, last_event_ts: last, version: existing.version + 1 })
          }),
        )
      }
      // A rename carries a partial object (`id`, `name`, `name_normalized`, `created`): only the name changes.
      case 'channel_rename':
      case 'group_rename': {
        if (typeof frame.channel === 'string' || frame.channel.name === undefined) return
        return yield* transaction(patchConversation(frame.channel.id, { name: frame.channel.name }))
      }
      // Conversations: an object refreshes the metadata; membership follows the event, never the object's `is_member`.
      case 'channel_joined':
      case 'channel_left':
      case 'channel_created':
      case 'channel_archive':
      case 'channel_unarchive':
      case 'channel_deleted':
      case 'channel_converted_to_shared':
      case 'group_joined':
      case 'group_left':
      case 'group_archive':
      case 'group_unarchive':
      case 'group_deleted':
        return yield* transaction(
          Effect.gen(function* () {
            const id = typeof frame.channel === 'string' ? frame.channel : frame.channel.id
            if (typeof frame.channel !== 'string') yield* upsertConversations([toConversationRow(frame.channel)])
            switch (frame.type) {
              case 'channel_joined':
              case 'group_joined':
                return yield* patchConversation(id, { is_member: 1, is_archived: 0 })
              case 'channel_left':
              case 'group_left':
                return yield* patchConversation(id, { is_member: 0 })
              case 'channel_archive':
              case 'group_archive':
                return yield* patchConversation(id, { is_archived: 1 })
              case 'channel_unarchive':
              case 'group_unarchive':
                return yield* patchConversation(id, { is_archived: 0 })
              case 'channel_deleted':
              case 'group_deleted':
                return yield* patchConversation(id, { is_archived: 1, is_member: 0 })
              default:
                return
            }
          }),
        )
      // DMs: opening, creating or being added makes the conversation the user's own. Closing only hides it in Slack's sidebar.
      case 'im_open':
      case 'im_created':
      case 'mpim_open':
      case 'mpim_joined':
        return yield* transaction(
          Effect.gen(function* () {
            const id = typeof frame.channel === 'string' ? frame.channel : frame.channel.id
            if (typeof frame.channel !== 'string') yield* upsertConversations([toConversationRow(frame.channel)])
            yield* patchConversation(id, { is_member: 1 })
          }),
        )
      case 'im_close':
      case 'mpim_close':
        if (typeof frame.channel === 'string') return
        return yield* transaction(upsertConversations([toConversationRow(frame.channel)]))
      case 'member_joined_channel':
      case 'member_left_channel':
        if (frame.user !== ctx.me.userId) return
        return yield* transaction(patchConversation(frame.channel, { is_member: frame.type === 'member_joined_channel' ? 1 : 0 }))
      case 'user_change':
        return yield* transaction(upsertUsers([frame.user]))
      case 'pref_change':
        return yield* transaction(setPref(frame.name, frame.value))
      default:
        return
    }
  })

const applyMessageFrame = (ctx: SyncContext, frame: Extract<RtmFrame, { type: 'message' }>, now: number): Effect.Effect<void, SqlError, Services> => {
  if (isMessagePosted(frame)) {
    const { event_ts: _e, hidden: _h, suppress_notification: _s, ...message } = frame
    return transaction(
      Effect.gen(function* () {
        const eventTs = eventTsOf(frame, now)
        const rows = yield* mergeOne(ctx, frame.channel, message as Message, { kind: 'event', eventTs })
        const topics = topicsOfMessages(rows)
        // Activity after a resolve reopens the topic, except the user's own messages are activity too.
        for (const row of rows) if (row.ts === frame.ts) yield* reopenIfResolved(topicOfMessage(row), frame.ts, now)
        yield* followOnReply(ctx, frame.channel, rows.find((row) => row.ts === frame.ts), { kind: 'event', eventTs, observedAt: millisToTs(now) })
        yield* reindexTopics(topics, reindexOptions(ctx))
      }),
    )
  }
  if (isMessageChanged(frame)) {
    return transaction(
      Effect.gen(function* () {
        const rows = yield* mergeOne(ctx, frame.channel, frame.message, { kind: 'event', eventTs: eventTsOf(frame, now) })
        yield* reindexTopics(topicsOfMessages(rows), reindexOptions(ctx))
      }),
    )
  }
  if (isMessageDeleted(frame)) {
    return transaction(
      Effect.gen(function* () {
        const existing = yield* readMessage(frame.channel, frame.deleted_ts)
        const merged = mergeTombstone(existing, frame.channel, frame.deleted_ts, { kind: 'event', eventTs: eventTsOf(frame, now) })
        if (merged.changed) yield* writeMessage(merged.row)
        const topics = topicsOfMessages([merged.row])
        // A deleted reply: the root's counters follow the stored replies when they are complete, else drop by one.
        const wasLiveReply = existing !== undefined && existing.deleted === 0 && existing.thread_ts !== null && existing.thread_ts !== existing.ts
        const root = wasLiveReply ? yield* readMessage(frame.channel, existing.thread_ts!) : undefined
        if (root !== undefined) {
          const sql = yield* StoreWriter
          const cursor = yield* sql<{ replies_complete: 0 | 1 }>`SELECT replies_complete FROM thread_cursors WHERE channel = ${frame.channel} AND thread_ts = ${root.ts}`
          const stored = (yield* threadMessages(frame.channel, root.ts)).filter((m) => m.ts !== root.ts && m.deleted === 0)
          const latestStored = stored.reduce<string | null>((acc, m) => (acc === null || compareTs(m.ts, acc) > 0 ? m.ts : acc), null)
          const complete = cursor[0]?.replies_complete === 1 || stored.length + 1 >= root.reply_count
          const replyCount = complete ? stored.length : Math.max(stored.length, root.reply_count - 1)
          const latestReply = root.latest_reply === frame.deleted_ts || complete ? latestStored : root.latest_reply
          if (replyCount !== root.reply_count || latestReply !== root.latest_reply) {
            yield* writeMessage({ ...root, reply_count: replyCount, latest_reply: latestReply, version: root.version + 1 })
          }
          topics.add(threadTopicOf(frame.channel, root.ts))
        }
        yield* reindexTopics(topics, reindexOptions(ctx))
      }),
    )
  }
  if (isMessageReplied(frame)) {
    return transaction(
      Effect.gen(function* () {
        const root = yield* readMessage(frame.channel, frame.message.ts)
        if (root === undefined) return
        const merged = mergeRootCounters(root, frame.message, { kind: 'event', eventTs: eventTsOf(frame, now) })
        if (merged.changed) yield* writeMessage(merged.row)
        yield* reindexTopics([threadTopicOf(frame.channel, root.ts)], reindexOptions(ctx))
      }),
    )
  }
  return Effect.void
}

/**
 * Slack follows a thread for you when you reply in it or when someone
 * replies to a thread you started (spec section 5, "Which threads"). A
 * `thread_subscribed` frame usually says so too, but not always, so a live
 * reply keeps the follow flag fresh on its own: a reply by the user always
 * follows; a reply to the user's root follows unless Slack has already said
 * otherwise. Pages do not need this: a root on a page carries `subscribed`
 * and `mergeOne` applies it.
 */
const followOnReply = (ctx: SyncContext, channel: string, reply: MessageRow | undefined, source: ThreadSubSource): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    if (reply === undefined || reply.thread_ts === null || reply.thread_ts === reply.ts) return
    const threadTs = reply.thread_ts
    if (reply.user_id === ctx.me.userId) {
      if ((yield* threadSub(channel, threadTs))?.subscribed !== true) yield* setThreadSub(channel, threadTs, true, undefined, source)
      return
    }
    const root = yield* readMessage(channel, threadTs)
    if (root?.user_id !== ctx.me.userId) return
    if ((yield* threadSub(channel, threadTs)) !== undefined) return
    yield* setThreadSub(channel, threadTs, true, undefined, source)
  })
