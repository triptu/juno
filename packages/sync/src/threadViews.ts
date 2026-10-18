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
import type { SyncContext } from './context'
import { FollowFence } from './followFence'
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

interface CursorRow {
  readonly channel: string
  readonly thread_ts: string
  readonly replies_complete: 0 | 1
  readonly complete_from: string | null
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

const messagesOf = (view: ThreadView): ReadonlyArray<Message> => {
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

/**
 * Certifies the getView rows that would only move follow observation
 * fences. The caller holds the writer transaction while this reads the page
 * in batches and publishes those in-process fences.
 */
export const threadViewPageUnchanged = (
  ctx: SyncContext,
  observations: ReadonlyArray<{ readonly view: ThreadView; readonly requestedAt: Ts }>,
): Effect.Effect<ReadonlyArray<boolean>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const views = observations.map(({ view }) => view)
    if (views.length === 0) return []
    const sql = yield* StoreWriter
    const fence = yield* FollowFence
    const roots = views.map((view) => view.root_msg.ts)
    const channels = [...new Set(views.map((view) => view.root_msg.channel))]
    const topics = views.map((view) => threadTopicId(view.root_msg.channel as ChannelId, view.root_msg.ts as Ts))

    const [messageRows, reactionRows, subscriptionRows, readRows, cursorRows, pendingRows] = yield* Effect.all([
      sql<MessageRow>`SELECT * FROM messages
        WHERE channel IN ${sql.in(channels)} AND (ts IN ${sql.in(roots)} OR thread_ts IN ${sql.in(roots)})`,
      sql<ReactionRow>`SELECT channel, ts, name, count, user_ids_json, me FROM reactions
        WHERE channel IN ${sql.in(channels)} AND ts IN ${sql.in(views.flatMap(messagesOf).map((message) => message.ts))}
        ORDER BY rowid`,
      sql<SubscriptionRow>`SELECT channel, thread_ts, subscribed, slack_last_read, observed_at FROM thread_subs
        WHERE channel IN ${sql.in(channels)} AND thread_ts IN ${sql.in(roots)}`,
      sql<ReadRow>`SELECT topic_id, last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded
        FROM topic_reads WHERE topic_id IN ${sql.in(topics)}`,
      sql<CursorRow>`SELECT channel, thread_ts, replies_complete, complete_from FROM thread_cursors
        WHERE channel IN ${sql.in(channels)} AND thread_ts IN ${sql.in(roots)}`,
      sql<{ kind: string; target_key: string }>`SELECT kind, target_key FROM outbox
        WHERE (kind = 'follow' AND target_key IN ${sql.in(topics)}) OR (kind = 'mark' AND target_key IN ${sql.in(topics)})`,
    ], { concurrency: 1 })

    const storedMessages = new Map(messageRows.map((row) => [keyOf(row.channel, row.ts), row]))
    const replyCounts = new Map<string, number>()
    for (const row of messageRows) {
      if (row.thread_ts === null || row.deleted === 1) continue
      const key = keyOf(row.channel, row.thread_ts)
      replyCounts.set(key, (replyCounts.get(key) ?? 0) + 1)
    }
    const reactions = new Map<string, Array<ReactionRow>>()
    for (const row of reactionRows) {
      const rows = reactions.get(keyOf(row.channel, row.ts)) ?? []
      rows.push(row)
      reactions.set(keyOf(row.channel, row.ts), rows)
    }
    const subscriptions = new Map(subscriptionRows.map((row) => [keyOf(row.channel, row.thread_ts), row]))
    const reads = new Map(readRows.map((row) => [row.topic_id, row]))
    const cursors = new Map(cursorRows.map((row) => [keyOf(row.channel, row.thread_ts), row]))
    const pending = new Set(pendingRows.map((row) => `${row.kind}:${row.target_key}`))
    const unchanged: Array<boolean> = []

    for (const { view, requestedAt } of observations) {
      const root = view.root_msg
      const channel = root.channel
      const rootKey = keyOf(channel, root.ts)
      const topic = threadTopicId(channel as ChannelId, root.ts as Ts)
      const incoming = messagesOf(view)
      let advanceFence = false
      const matches = (() => {
        if (incoming.some((message) => ctx.lateReactions.has(keyOf(channel, message.ts)))) return false

        for (const message of incoming) {
          const stored = storedMessages.get(keyOf(channel, message.ts))
          if (stored === undefined) return false
          const merged = mergeMessage(stored, message, channel, { kind: 'page', requestedAt })
          if (merged.changed) return false
          if (merged.applyReactions && !sameReactions(reactions.get(keyOf(channel, message.ts)) ?? [], message.reactions ?? [], ctx.me.userId)) return false
        }

        const storedRoot = storedMessages.get(rootKey)
        if (storedRoot === undefined) return false
        const replyCount = replyCounts.get(rootKey) ?? 0
        for (const reply of incoming.slice(1)) {
          if (mergeRootCounters(storedRoot, { reply_count: replyCount, latest_reply: reply.ts }, { kind: 'page', requestedAt }).changed) return false
        }

        const sub = subscriptions.get(rootKey)
        if (sub === undefined || pending.has(`follow:${topic}`)) return false
        const subscribed = root.subscribed ?? true
        if (sub.subscribed !== (subscribed ? 1 : 0)) return false
        if (root.last_read !== undefined && sub.slack_last_read !== root.last_read) return false
        const observedAt = fence.effective(channel, root.ts, sub.observed_at ?? undefined)
        advanceFence = observedAt === undefined || compareTs(requestedAt, observedAt) > 0

        const read = reads.get(topic)
        if (read === undefined) return false
        if (root.last_read !== undefined) {
          if (pending.has(`mark:${topic}`)) return false
          const outcome = observeServerRead(toReadState(read, false), {
            kind: 'page',
            lastReadTs: root.last_read as Ts,
            requestedAt,
          }).outcome
          if (outcome !== 'ignored') return false
        }

        const completeFrom = root.last_read ?? root.latest_reply ?? root.ts
        const cursor = cursors.get(rootKey)
        const complete = replyCount >= root.reply_count
        const nextFrom = cursor?.complete_from === null || cursor?.complete_from === undefined || compareTs(completeFrom, cursor.complete_from) < 0
          ? completeFrom
          : cursor.complete_from
        return cursor !== undefined && cursor.replies_complete === (complete ? 1 : 0) && cursor.complete_from === nextFrom
      })()
      unchanged.push(matches && (!advanceFence || fence.advance(channel, root.ts, requestedAt)))
    }
    return unchanged
  })
