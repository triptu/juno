import {
  compareTs,
  observeServerRead,
  threadTopicId,
  type ChannelId,
  type ReadState,
  type Ts,
} from '@juno/domain'
import type { Message, Reaction, ThreadView } from '@juno/slack-schema'
import { StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { stillConnected, type SyncContext } from './context'
import { addsNothing, pageRange, type ThreadRange } from './threadRanges'
import { FollowFence, type FollowFenceService } from './followFence'
import { mergeMessage, mergeRootCounters } from './merge'

interface SubscriptionRow {
  readonly channel: string
  readonly thread_ts: string
  readonly subscribed: 0 | 1
  readonly slack_last_read: string | null
  readonly observed_at: string | null
}

interface ReadRow {
  readonly topic_id: string
  readonly last_read_ts: string | null
  readonly marked_unread: 0 | 1
  readonly local_write_ack_ts: string | null
  readonly last_server_event_ts: string | null
  readonly observed_at: string | null
  readonly slack_read_ts: string | null
  readonly commanded: 0 | 1
}

interface RangeRow extends ThreadRange {
  readonly channel: string
  readonly thread_ts: string
}

/** One `getView` row, when it was asked for, and the socket connection it was asked on (`connectionOf`). */
export interface ViewObservation {
  readonly view: ThreadView
  readonly requestedAt: Ts
  readonly connection: number | undefined
}

interface ReactionRow {
  readonly channel: string
  readonly ts: string
  readonly name: string
  readonly count: number
  readonly user_ids_json: string
  readonly me: 0 | 1
}

const keyOf = (channel: string, ts: string): string => `${channel}:${ts}`

export const messagesOf = (view: ThreadView): ReadonlyArray<Message> => {
  const seen = new Map<string, Message>()
  for (const reply of [...(view.latest_replies ?? []), ...(view.unread_replies ?? [])]) seen.set(reply.ts, reply)
  return [view.root_msg, ...seen.values()]
}

const expectedReactions = (reactions: ReadonlyArray<Reaction>, selfId: string) =>
  reactions.map((reaction) => {
    const users = reaction.users ?? []
    return {
      name: reaction.name,
      count: reaction.count ?? users.length,
      user_ids_json: JSON.stringify(users),
      me: users.includes(selfId) ? 1 : 0,
    }
  })

const sameReactions = (stored: ReadonlyArray<ReactionRow>, incoming: ReadonlyArray<Reaction>, selfId: string): boolean => {
  const expected = expectedReactions(incoming, selfId)
  return stored.length === expected.length && stored.every((row, index) => {
    const next = expected[index]
    return next !== undefined && row.name === next.name && row.count === next.count && row.user_ids_json === next.user_ids_json && row.me === next.me
  })
}

const toReadState = (row: ReadRow, pending: boolean): ReadState => ({
  ...(row.last_read_ts === null ? {} : { lastReadTs: row.last_read_ts as Ts }),
  markedUnread: row.marked_unread === 1,
  pendingLocalWrite: pending,
  ...(row.local_write_ack_ts === null ? {} : { localWriteAckTs: row.local_write_ack_ts as Ts }),
  ...(row.last_server_event_ts === null ? {} : { lastServerEventTs: row.last_server_event_ts as Ts }),
  ...(row.observed_at === null ? {} : { observedAt: row.observed_at as Ts }),
  ...(row.slack_read_ts === null ? {} : { slackReadTs: row.slack_read_ts as Ts }),
  commanded: row.commanded === 1,
})

interface PageSnapshot {
  readonly messages: ReadonlyArray<MessageRow>
  readonly messageByKey: ReadonlyMap<string, MessageRow>
  readonly reactions: ReadonlyMap<string, ReadonlyArray<ReactionRow>>
  readonly subscriptions: ReadonlyMap<string, SubscriptionRow>
  readonly reads: ReadonlyMap<string, ReadRow>
  readonly ranges: ReadonlyMap<string, ReadonlyArray<ThreadRange>>
  readonly pending: ReadonlySet<string>
}

const pageSnapshot = (views: ReadonlyArray<ThreadView>): Effect.Effect<PageSnapshot, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const roots = views.map((view) => view.root_msg.ts)
    const channels = [...new Set(views.map((view) => view.root_msg.channel))]
    const topics = views.map((view) => threadTopicId(view.root_msg.channel as ChannelId, view.root_msg.ts as Ts))
    const [messages, reactionRows, subscriptionRows, readRows, rangeRows, pendingRows] = yield* Effect.all([
      sql<MessageRow>`SELECT * FROM messages
        WHERE channel IN ${sql.in(channels)} AND (ts IN ${sql.in(roots)} OR thread_ts IN ${sql.in(roots)})`,
      sql<ReactionRow>`SELECT channel, ts, name, count, user_ids_json, me FROM reactions
        WHERE channel IN ${sql.in(channels)} AND ts IN ${sql.in(views.flatMap(messagesOf).map((message) => message.ts))}
        ORDER BY rowid`,
      sql<SubscriptionRow>`SELECT channel, thread_ts, subscribed, slack_last_read, observed_at FROM thread_subs
        WHERE channel IN ${sql.in(channels)} AND thread_ts IN ${sql.in(roots)}`,
      sql<ReadRow>`SELECT topic_id, last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded
        FROM topic_reads WHERE topic_id IN ${sql.in(topics)}`,
      sql<RangeRow>`SELECT channel, thread_ts, kind, from_ts, to_ts, tail FROM thread_ranges
        WHERE channel IN ${sql.in(channels)} AND thread_ts IN ${sql.in(roots)} ORDER BY from_ts`,
      sql<{ kind: string; target_key: string }>`SELECT kind, target_key FROM outbox
        WHERE (kind = 'follow' AND target_key IN ${sql.in(topics)}) OR (kind = 'mark' AND target_key IN ${sql.in(topics)})`,
    ], { concurrency: 1 })
    const reactions = new Map<string, Array<ReactionRow>>()
    for (const row of reactionRows) {
      const rows = reactions.get(keyOf(row.channel, row.ts)) ?? []
      rows.push(row)
      reactions.set(keyOf(row.channel, row.ts), rows)
    }
    const ranges = new Map<string, Array<ThreadRange>>()
    for (const row of rangeRows) {
      const key = keyOf(row.channel, row.thread_ts)
      ranges.set(key, [...(ranges.get(key) ?? []), { kind: row.kind, from_ts: row.from_ts, to_ts: row.to_ts, tail: row.tail }])
    }
    return {
      messages,
      messageByKey: new Map(messages.map((row) => [keyOf(row.channel, row.ts), row])),
      reactions,
      subscriptions: new Map(subscriptionRows.map((row) => [keyOf(row.channel, row.thread_ts), row])),
      reads: new Map(readRows.map((row) => [row.topic_id, row])),
      ranges,
      pending: new Set(pendingRows.map((row) => `${row.kind}:${row.target_key}`)),
    }
  })

const observationUnchanged = (
  ctx: SyncContext,
  snapshot: PageSnapshot,
  fence: FollowFenceService,
  { view, requestedAt, connection }: ViewObservation,
): boolean => {
  const root = view.root_msg
  const channel = root.channel
  const rootKey = keyOf(channel, root.ts)
  const topic = threadTopicId(channel as ChannelId, root.ts as Ts)
  const incoming = messagesOf(view)
  if (incoming.some((message) => ctx.lateReactions.has(keyOf(channel, message.ts)))) return false
  for (const message of incoming) {
    const stored = snapshot.messageByKey.get(keyOf(channel, message.ts))
    if (stored === undefined) return false
    const merged = mergeMessage(stored, message, channel, { kind: 'page', requestedAt })
    if (merged.changed) return false
    if (merged.applyReactions && !sameReactions(snapshot.reactions.get(keyOf(channel, message.ts)) ?? [], message.reactions ?? [], ctx.me.userId)) return false
  }
  const storedRoot = snapshot.messageByKey.get(rootKey)
  if (storedRoot === undefined) return false
  const replyCount = snapshot.messages.filter((row) => row.channel === channel && row.ts !== root.ts && row.thread_ts === root.ts && row.deleted === 0).length
  for (const reply of incoming.slice(1)) {
    if (mergeRootCounters(storedRoot, { reply_count: replyCount, latest_reply: reply.ts }, { kind: 'page', requestedAt }).changed) return false
  }
  const sub = snapshot.subscriptions.get(rootKey)
  if (sub === undefined || snapshot.pending.has(`follow:${topic}`)) return false
  if (sub.subscribed !== ((root.subscribed ?? true) ? 1 : 0)) return false
  if (root.last_read !== undefined && sub.slack_last_read !== root.last_read) return false
  const read = snapshot.reads.get(topic)
  if (read === undefined) return false
  if (root.last_read !== undefined) {
    if (snapshot.pending.has(`mark:${topic}`)) return false
    const outcome = observeServerRead(toReadState(read, false), { kind: 'page', lastReadTs: root.last_read as Ts, requestedAt }).outcome
    if (outcome !== 'ignored') return false
  }
  // The range the view proves must add nothing to the stored ones.
  const range = viewRange(view, stillConnected(ctx, connection))
  if (range !== undefined && !addsNothing(snapshot.ranges.get(rootKey) ?? [], range)) return false
  const observedAt = fence.effective(channel, root.ts, sub.observed_at ?? undefined)
  return (observedAt !== undefined && compareTs(requestedAt, observedAt) <= 0) || fence.advance(channel, root.ts, requestedAt)
}

/**
 * Certifies the getView rows that would only move follow observation
 * fences. The caller holds the writer transaction while this reads the page
 * in batches and publishes those in-process fences.
 */
export const threadViewPageUnchanged = (
  ctx: SyncContext,
  observations: ReadonlyArray<ViewObservation>,
): Effect.Effect<ReadonlyArray<boolean>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const views = observations.map(({ view }) => view)
    if (views.length === 0) return []
    const fence = yield* FollowFence
    const snapshot = yield* pageSnapshot(views)
    return observations.map((observation) => observationUnchanged(ctx, snapshot, fence, observation))
  })

/**
 * What a `getView` row proves for the unread count (`threadRanges.ts`, a
 * `view` range): it carries every unread reply, so every reply after
 * Slack's read pointer (after the latest reply when it gives none) is in
 * it; and `latest_replies` are the thread's newest replies, so every reply
 * after the oldest of them is too.
 */
export const viewRange = (view: ThreadView, live: boolean): ThreadRange | undefined => {
  const root = view.root_msg
  const latest = (view.latest_replies ?? []).map((reply) => reply.ts).toSorted(compareTs)[0]
  const pointer = root.last_read ?? root.latest_reply ?? root.ts
  const from = latest !== undefined && compareTs(latest, pointer) < 0 ? latest : pointer
  const replies = messagesOf(view).slice(1).map((message) => message.ts).filter((ts) => compareTs(ts, from) > 0).toSorted(compareTs)
  return pageRange({ threadTs: root.ts, oldest: from, replies, hasMore: false, live, kind: 'view' })
}
