/**
 * Invalidation keys the sync fires and the live queries subscribe to
 * (architecture 4.1 and 4.5). Keys are specific: a socket event re-runs only
 * the queries that read the rows it changed.
 *
 * - `topics` / `{ topics: [id] }`: a `topic_index` row changed. The sidebar
 *   subscribes to the table; a topic detail subscribes to its id.
 * - `{ messages: [topicId] }`: the messages or reactions of one topic.
 * - `conversations`, `users`, `team`, `channel_reads`, `thread_subs`:
 *   mirror tables the view models join.
 * - `{ topic_reads: [id] }`, `{ topic_overlay: [id] }`: Juno's own state.
 */
import type { InvalidationKeys } from '@juno/store'

export const syncKeys = {
  topics: ['topics'] satisfies InvalidationKeys,
  topic: (id: string) => ({ topics: [id] }) satisfies InvalidationKeys,
  messages: (topicId: string) => ({ messages: [topicId] }) satisfies InvalidationKeys,
  conversations: ['conversations'] satisfies InvalidationKeys,
  users: ['users'] satisfies InvalidationKeys,
  team: ['team'] satisfies InvalidationKeys,
  channelReads: ['channel_reads'] satisfies InvalidationKeys,
  threadSubs: ['thread_subs'] satisfies InvalidationKeys,
  reads: (topicId: string) => ({ topic_reads: [topicId] }) satisfies InvalidationKeys,
  overlay: (topicId: string) => ({ topic_overlay: [topicId] }) satisfies InvalidationKeys,
}
