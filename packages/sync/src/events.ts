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
  type Channel,
  type Message,
  type RtmFrame,
} from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type MessageRow, type SqlError } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { writeHuddleFrame } from './write/huddles'
import { observeMetadata, patchMetadata, type MetadataFence } from './metadata'
import { reindexOptions, wantUsers, type SyncContext } from './context'
import { mergeRootCounters, mergeTombstone, type MergeSource } from './merge'
import { mainTopicOf, mergeOne, threadTopicOf } from './pages'
import { reindexTopics, topicsOfMessages } from './reindex'
import { applyUsergroups, changeOwnUsergroup } from './usergroups'
import {
  changeReaction,
  observeRead,
  readMessage,
  reopenIfResolved,
  setChannelReads,
  setPref,
  setThreadSub,
  threadMessages,
  threadSub,
  toConversationRow,
  topicOfMessage,
  upsertUsers,
  writeMessage,
  type ThreadSubSource,
} from './write'

type Services = StoreWriter | Invalidation

const LATE_REACTIONS_MAX = 1000
const DAY = 24 * 60 * 60 * 1000

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
            // A mark without `event_ts` has no place in the event order: ask Slack (specs/readstate.qnt).
            const outcome =
              frame.event_ts === undefined
                ? 'lookup'
                : yield* observeRead(topic, { kind: 'event', lastReadTs: frame.ts, eventTs: frame.event_ts, observedAt: millisToTs(now) })
            if (outcome === 'lookup') yield* Queue.offer(ctx.readLookups, frame.channel)
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
        // An event without `event_ts` has no place in the order: ask Slack for the root instead (specs/follow.qnt, readstate.qnt).
        if (frame.event_ts === undefined) return yield* Queue.offer(ctx.rootFetches, { channel: frame.subscription.channel, ts: frame.subscription.thread_ts })
        return yield* transaction(
          Effect.gen(function* () {
            const sub = frame.subscription
            const eventTs = frame.event_ts as Ts
            // `thread_marked` says whether the thread is followed only when it carries `active`.
            const subscribed = frame.type === 'thread_unsubscribed' ? false : frame.type === 'thread_subscribed' ? (sub.active ?? true) : sub.active
            const source = { kind: 'event', eventTs, observedAt: millisToTs(now) } as const
            // An event that contradicts Juno's own command may predate it: Slack's root decides (specs/follow.qnt).
            const outcome = subscribed === undefined ? 'ignored' : yield* setThreadSub(sub.channel, sub.thread_ts, subscribed, sub.last_read, source)
            const topic = threadTopicOf(sub.channel, sub.thread_ts)
            // The same holds for the read pointer after Juno's own mark (specs/readstate.qnt).
            const read = sub.last_read === undefined ? 'ignored' : yield* observeRead(topic, { kind: 'event', lastReadTs: sub.last_read, eventTs, observedAt: source.observedAt })
            if (outcome === 'lookup' || read === 'lookup') yield* Queue.offer(ctx.rootFetches, { channel: sub.channel, ts: sub.thread_ts })
            yield* reindexTopics([topic], reindexOptions(ctx))
          }),
        )
      case 'reaction_added':
      case 'reaction_removed': {
        if (frame.item.type !== 'message') return
        const { channel, ts } = frame.item
        return yield* transaction(writeReaction(ctx, { channel, ts, name: frame.reaction, user: frame.user, added: frame.type === 'reaction_added' }, frame.event_ts))
      }
      // A rename carries a partial object (`id`, `name`, `name_normalized`, `created`): only the name changes.
      case 'channel_rename':
      case 'group_rename': {
        if (typeof frame.channel === 'string' || frame.channel.name === undefined) return
        return yield* transaction(patchMetadata(ctx.metadata, frame.channel.id, { name: frame.channel.name }))
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
            if (typeof frame.channel !== 'string') yield* observeMetadata(ctx.metadata, frame.channel)
            switch (frame.type) {
              case 'channel_joined':
              case 'group_joined':
                return yield* patchMetadata(ctx.metadata, id, { is_member: 1, is_archived: 0 })
              case 'channel_left':
              case 'group_left':
                return yield* patchMetadata(ctx.metadata, id, { is_member: 0 })
              case 'channel_archive':
              case 'group_archive':
                return yield* patchMetadata(ctx.metadata, id, { is_archived: 1 })
              case 'channel_unarchive':
              case 'group_unarchive':
                return yield* patchMetadata(ctx.metadata, id, { is_archived: 0 })
              case 'channel_deleted':
              case 'group_deleted':
                return yield* patchMetadata(ctx.metadata, id, { is_archived: 1, is_member: 0 })
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
            if (typeof frame.channel !== 'string') {
              const row = toConversationRow(frame.channel)
              yield* observeMetadata(ctx.metadata, frame.channel)
              // The other side of a new DM, or the members of a group DM, before its row shows.
              wantUsers(ctx, [...(row.user_id === null ? [] : [row.user_id]), ...(row.member_ids_json === null ? [] : (JSON.parse(row.member_ids_json) as Array<string>))])
            }
            yield* patchMetadata(ctx.metadata, id, { is_member: 1 })
          }),
        )
      case 'im_close':
      case 'mpim_close':
        if (typeof frame.channel === 'string') return
        return yield* transaction(observeMetadata(ctx.metadata, frame.channel))
      case 'member_joined_channel':
      case 'member_left_channel':
        if (frame.user !== ctx.me.userId) return
        return yield* transaction(patchMetadata(ctx.metadata, frame.channel, { is_member: frame.type === 'member_joined_channel' ? 1 : 0 }))
      case 'user_change':
        return yield* transaction(upsertUsers([frame.user]))
      case 'subteam_created':
      case 'subteam_updated':
        return yield* transaction(applyUsergroups(ctx, [frame.subteam]))
      case 'subteam_members_changed': {
        const joined = frame.added_users?.includes(ctx.me.userId) === true
        const left = frame.removed_users?.includes(ctx.me.userId) === true
        if (joined === left) return
        return yield* transaction(changeOwnUsergroup(ctx, frame.subteam_id, joined))
      }
      case 'subteam_self_added':
      case 'subteam_self_removed':
        return yield* transaction(changeOwnUsergroup(ctx, frame.subteam_id, frame.type === 'subteam_self_added'))
      case 'pref_change':
        return yield* transaction(setPref(frame.name, frame.value))
      case 'file_created':
      case 'file_change':
      case 'file_shared':
      case 'file_thumbnail_generated':
        // Carries no sizes: file info or a message re-read brings the thumbnails with them (`run/files.ts`).
        return yield* Queue.offer(ctx.fileFetches, { kind: 'event', fileId: frame.file_id })
      case 'unknown':
        return yield* transaction(writeHuddleFrame(frame.raw, ctx.me.userId))
      default:
        return
    }
  })

/** A new message, from its socket event or from Juno's own send. */
const writePosted = (ctx: SyncContext, channel: string, message: Message, eventTs: string, now: number): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const rows = yield* mergeOne(ctx, channel, message, { kind: 'event', eventTs })
    const topics = topicsOfMessages(rows)
    // Activity after a resolve reopens the topic, except the user's own messages are activity too.
    for (const row of rows) if (row.ts === message.ts) yield* reopenIfResolved(topicOfMessage(row), message.ts, now)
    yield* followOnReply(ctx, channel, rows.find((row) => row.ts === message.ts), { kind: 'event', eventTs, observedAt: millisToTs(now) }, now)
    yield* reindexTopics(topics, reindexOptions(ctx))
  })

/**
 * What Juno's own send got back (`chat.postMessage`, and `conversations.open`
 * when it opened a DM), stored as the socket's `im_created` and message
 * echo would store it, so the topic can open before the echo arrives. The
 * echo then changes nothing: it carries the same message and event ts.
 */
export const applySent = (ctx: SyncContext, sent: { readonly opened?: Channel | undefined; readonly channel: string; readonly message: Message }): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    yield* transaction(
      Effect.gen(function* () {
        if (sent.opened !== undefined) {
          yield* applyOpened(ctx.metadata, sent.opened)
        }
        yield* writePosted(ctx, sent.channel, sent.message, sent.message.ts, now)
      }),
    )
  })

/** A DM Juno opened for a send (`conversations.open`), stored as the socket's `im_created` would store it. */
export const applyOpened = (fence: MetadataFence, channel: Channel): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  transaction(
    Effect.gen(function* () {
      yield* observeMetadata(fence, channel)
      yield* patchMetadata(fence, channel.id, { is_member: 1 })
    }),
  )

/** An edited message (`message_changed`, or Juno's own edit answered). */
export const writeChanged = (ctx: SyncContext, channel: string, message: Message, eventTs: string): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const rows = yield* mergeOne(ctx, channel, message, { kind: 'event', eventTs })
    yield* reindexTopics(topicsOfMessages(rows), reindexOptions(ctx))
  })

/** A deleted message (`message_deleted`, Juno's own delete answered, or a message the recheck found gone). */
export const writeDeleted = (ctx: SyncContext, channel: string, deletedTs: string, source: MergeSource): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const existing = yield* readMessage(channel, deletedTs)
    const merged = mergeTombstone(existing, channel, deletedTs, source)
    if (merged.changed) yield* writeMessage(merged.row)
    const topics = topicsOfMessages([merged.row])
    // A deleted reply: the root's counters follow the stored replies when they are complete, else drop by one.
    const wasLiveReply = existing !== undefined && existing.deleted === 0 && existing.thread_ts !== null && existing.thread_ts !== existing.ts
    const root = wasLiveReply ? yield* readMessage(channel, existing.thread_ts!) : undefined
    if (root !== undefined) {
      const sql = yield* StoreWriter
      const cursor = yield* sql<{ replies_complete: 0 | 1 }>`SELECT replies_complete FROM thread_cursors WHERE channel = ${channel} AND thread_ts = ${root.ts}`
      const stored = (yield* threadMessages(channel, root.ts)).filter((m) => m.ts !== root.ts && m.deleted === 0)
      const latestStored = stored.reduce<string | null>((acc, m) => (acc === null || compareTs(m.ts, acc) > 0 ? m.ts : acc), null)
      const complete = cursor[0]?.replies_complete === 1 || stored.length + 1 >= root.reply_count
      const replyCount = complete ? stored.length : Math.max(stored.length, root.reply_count - 1)
      const latestReply = root.latest_reply === deletedTs || complete ? latestStored : root.latest_reply
      if (replyCount !== root.reply_count || latestReply !== root.latest_reply) {
        yield* writeMessage({ ...root, reply_count: replyCount, latest_reply: latestReply, version: root.version + 1 })
      }
      topics.add(threadTopicOf(channel, root.ts))
    }
    yield* reindexTopics(topics, reindexOptions(ctx))
  })

interface ReactionChange {
  readonly channel: string
  readonly ts: string
  readonly name: string
  readonly user: string
  readonly added: boolean
}

/** One user's reaction added or removed (`reaction_added` and `reaction_removed`, or Juno's own answered). */
export const writeReaction = (ctx: SyncContext, change: ReactionChange, eventTs: string): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const existing = yield* readMessage(change.channel, change.ts)
    if (existing === undefined) return yield* noteLateReaction(ctx, change.channel, change.ts, eventTs)
    yield* changeReaction(existing, change.name, change.user, change.added, ctx.me.userId)
    const last = existing.last_event_ts === null ? eventTs : compareTs(eventTs, existing.last_event_ts) > 0 ? eventTs : existing.last_event_ts
    if (last !== existing.last_event_ts) yield* writeMessage({ ...existing, last_event_ts: last, version: existing.version + 1 })
  })

const applyMessageFrame = (ctx: SyncContext, frame: Extract<RtmFrame, { type: 'message' }>, now: number): Effect.Effect<void, SqlError, Services> => {
  if (isMessagePosted(frame)) {
    const { event_ts: _e, hidden: _h, suppress_notification: _s, ...message } = frame
    return transaction(writePosted(ctx, frame.channel, message as Message, eventTsOf(frame, now), now))
  }
  if (isMessageChanged(frame)) return transaction(writeChanged(ctx, frame.channel, frame.message, eventTsOf(frame, now)))
  if (isMessageDeleted(frame)) return transaction(writeDeleted(ctx, frame.channel, frame.deleted_ts, { kind: 'event', eventTs: eventTsOf(frame, now) }))
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
const followOnReply = (ctx: SyncContext, channel: string, reply: MessageRow | undefined, source: ThreadSubSource, now: number): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    if (reply === undefined || reply.thread_ts === null || reply.thread_ts === reply.ts) return
    const threadTs = reply.thread_ts
    // No pass reads follows older than the window, so one last seen before it may be stale: ask for the root once
    // its thread is active again. The root carries `subscribed`; until it lands the reply may show the row.
    const known = yield* threadSub(channel, threadTs)
    const staleBefore = millisToTs(now - ctx.config.quietDays * DAY)
    if (reply.user_id !== ctx.me.userId && known?.subscribed === true && (known.observedAt === undefined || compareTs(known.observedAt, staleBefore) < 0)) {
      yield* Queue.offer(ctx.rootFetches, { channel, ts: threadTs })
    }
    if (reply.user_id === ctx.me.userId) {
      if ((yield* threadSub(channel, threadTs))?.subscribed === true) return
      if ((yield* setThreadSub(channel, threadTs, true, undefined, source)) === 'lookup') yield* Queue.offer(ctx.rootFetches, { channel, ts: threadTs })
      return
    }
    const root = yield* readMessage(channel, threadTs)
    if (root?.user_id !== ctx.me.userId) return
    if ((yield* threadSub(channel, threadTs)) !== undefined) return
    yield* setThreadSub(channel, threadTs, true, undefined, source)
  })
