/**
 * Invalidation keys the sync fires and the live queries subscribe to
 * (architecture 4.1 and 4.5). Keys are specific: a socket event re-runs only
 * the queries that read the rows it changed.
 *
 * - `topics` / `{ topics: [id] }`: a `topic_index` row changed. The sidebar
 *   subscribes to the table; a topic detail subscribes to its id.
 * - `{ messages: [topicId] }`: the messages or reactions of one topic. A
 *   message write fires every topic that shows it (`messagesOf`).
 * - `conversations`, `users`, `team`, `channel_reads`, `thread_subs`:
 *   mirror tables the view models join.
 * - `{ topic_reads: [id] }`, `{ topic_overlay: [id] }`, `ignored_channels`: Juno's own state.
 */
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import type { InvalidationKeys, MessageRow } from '@juno/store'

/**
 * Every topic that shows a message: Main for a root, and its thread too once
 * it has one; the thread for a reply, and Main too for a reply also sent to
 * the channel.
 */
export function messageTopics(row: Pick<MessageRow, 'channel' | 'ts' | 'thread_ts' | 'subtype' | 'reply_count'>): ReadonlyArray<string> {
  const channel = row.channel as ChannelId
  const isReply = row.thread_ts !== null && row.thread_ts !== row.ts
  if (isReply) {
    const thread = threadTopicId(channel, row.thread_ts as Ts)
    return row.subtype === 'thread_broadcast' ? [thread, mainTopicId(channel)] : [thread]
  }
  const main = mainTopicId(channel)
  return row.reply_count > 0 || row.thread_ts === row.ts ? [main, threadTopicId(channel, row.ts as Ts)] : [main]
}

export const syncKeys = {
  topics: ['topics'] satisfies InvalidationKeys,
  topic: (id: string) => ({ topics: [id] }) satisfies InvalidationKeys,
  messages: (topicId: string) => ({ messages: [topicId] }) satisfies InvalidationKeys,
  /** Every topic that shows the message (`messageTopics`): a root edit re-runs both Main and its thread. */
  messagesOf: (row: Parameters<typeof messageTopics>[0]) => ({ messages: messageTopics(row) }) satisfies InvalidationKeys,
  conversations: ['conversations'] satisfies InvalidationKeys,
  users: ['users'] satisfies InvalidationKeys,
  team: ['team'] satisfies InvalidationKeys,
  channelReads: ['channel_reads'] satisfies InvalidationKeys,
  threadSubs: ['thread_subs'] satisfies InvalidationKeys,
  reads: (topicId: string) => ({ topic_reads: [topicId] }) satisfies InvalidationKeys,
  overlay: (topicId: string) => ({ topic_overlay: [topicId] }) satisfies InvalidationKeys,
  ignored: ['ignored_channels'] satisfies InvalidationKeys,
}
