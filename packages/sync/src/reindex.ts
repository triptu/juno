/**
 * `reindexTopics(ids)`: the one writer of `topic_index` (ADR 0004). It
 * loads a topic's messages and read state from the source tables, computes
 * the row with the pure `indexTopic` rule in `@juno/domain`, and writes it
 * when it differs from the stored row, bumping `rev`. No counter is ever
 * incremented in place; a rebuild from the mirror gives the same rows.
 *
 * Runs on the writer connection inside the caller's transaction, at the end
 * of every page, event or command that touched the topics it is given.
 *
 * What the pure rule cannot know is added here from the mirror:
 * - a thread whose replies are not all stored takes `message_count` and
 *   `last_activity_ts` from the root's counters and reports `unread_exact`
 *   as false unless the read pointer is at or past `latest_reply`;
 * - Main takes `has_unreads` and `mention_count` from `client.counts` and is
 *   exact only when a synced range covers everything since the read pointer.
 */
import {
  compareTs,
  indexTopic,
  maxTs,
  parseTopicId,
  UNKNOWN_PERSON,
  type IndexInput,
  type IndexMessage,
  type Me,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { Attachment, Block } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type MessageRow, type SqlError, type TopicIndexRow } from '@juno/store'
import { Effect } from 'effect'
import { messageTopics, syncKeys } from './keys'
import { latestSyncedRange, readState, threadMessages } from './write'

export interface ReindexOptions {
  readonly me: Me
  /** A sender or a mention had no row in `users`. The caller fetches the user and re-indexes the topic. */
  readonly onMissingUser?: (userId: string, topicId: string) => void
}

/**
 * The stored preview: what the row shows plus the sender id, so a later name
 * change can be applied at read time, and the start of the root's text for
 * the fallback title, so the sidebar query needs no join on `messages`.
 */
export interface StoredPreview {
  readonly sender: string
  readonly text: string
  readonly senderId?: string
  readonly rootText?: string
}

/** Enough of a root for `firstWords`, never a whole message. */
export const ROOT_TEXT_CHARS = 240

const MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g
const CHANNEL_MENTION = /<#([A-Z0-9]+)(?:\|[^>]*)?>/g

/** Recomputes the index rows for `ids`. Returns the ids whose row changed. */
export const reindexTopics = (
  ids: Iterable<string>,
  options: ReindexOptions,
): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const changed: Array<string> = []
    for (const id of new Set(ids)) {
      if (yield* reindexOne(id, options)) changed.push(id)
    }
    return changed
  })

/** Every topic the index knows, for a full rebuild. */
export const reindexAll = (options: ReindexOptions): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_index`
    return yield* reindexTopics(
      rows.map((r) => r.topic_id),
      options,
    )
  })

/** Topic ids a set of message rows belongs to: Main for roots, the thread for replies, both for broadcasts. */
export function topicsOfMessages(rows: Iterable<Pick<MessageRow, 'channel' | 'ts' | 'thread_ts' | 'subtype' | 'reply_count'>>): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) for (const id of messageTopics(row)) ids.add(id)
  return ids
}

const reindexOne = (id: string, options: ReindexOptions): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const parsed = parseTopicId(id)
    if (parsed === undefined) return false
    const sql = yield* StoreWriter
    const channel = parsed.channel

    const rows: ReadonlyArray<MessageRow> =
      parsed.kind === 'thread'
        ? yield* threadMessages(channel, parsed.threadTs)
        : yield* sql<MessageRow>`
            SELECT * FROM messages WHERE channel = ${channel}
              AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')`
    const reads = yield* readState(id)
    const root = parsed.kind === 'thread' ? rows.find((r) => r.ts === parsed.threadTs) : undefined

    // Names for the preview: the latest live message's sender and mentions.
    const live = rows.filter((r) => r.deleted === 0)
    let latest: MessageRow | undefined
    for (const row of live) if (latest === undefined || compareTs(row.ts, latest.ts) > 0) latest = row
    const userIds = new Set<string>()
    const channelIds = new Set<string>()
    if (latest !== undefined) {
      if (latest.user_id !== null) userIds.add(latest.user_id)
      for (const match of latest.text.matchAll(MENTION)) userIds.add(match[1]!)
      for (const match of latest.text.matchAll(CHANNEL_MENTION)) channelIds.add(match[1]!)
    }
    const users = new Map<string, string>()
    if (userIds.size > 0) {
      const found = yield* sql<{ id: string; display_name: string | null; real_name: string | null; name: string | null }>`
        SELECT id, display_name, real_name, name FROM users WHERE id IN ${sql.in([...userIds])}`
      for (const user of found) users.set(user.id, user.display_name ?? user.real_name ?? user.name ?? user.id)
    }
    const channels = new Map<string, string>()
    if (channelIds.size > 0) {
      const found = yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in([...channelIds])}`
      for (const c of found) if (c.name !== null) channels.set(c.id, c.name)
    }
    const missing = (userId: string) => {
      options.onMissingUser?.(userId, id)
      return undefined
    }
    const lookups: IndexInput['lookups'] = {
      me: options.me.userId,
      user: (userId) => users.get(userId) ?? missing(userId),
      channel: (channelId) => channels.get(channelId),
    }
    const senderName = (userId: UserId | undefined) => (userId === undefined ? 'Unknown' : (users.get(userId) ?? missing(userId) ?? UNKNOWN_PERSON))

    // Coverage: is the stored history enough for an exact count?
    let historyComplete = true
    let unreadFloor = 0
    let mentionsFromCounts = false
    let countersCount = 0
    let countersActivity: string | undefined
    if (parsed.kind === 'thread') {
      const replyCount = root?.reply_count ?? 0
      const storedReplies = live.filter((r) => r.ts !== parsed.threadTs).length
      const cursor = yield* sql<{ complete_from: string | null }>`
        SELECT complete_from FROM thread_cursors WHERE channel = ${channel} AND thread_ts = ${parsed.threadTs}`
      // Complete means every reply the root counts is stored. `replies_complete` is not trusted here: it was true
      // when a page landed, and `reply_count` may have grown since without the replies (a drop).
      const complete = storedReplies >= replyCount
      const latestReply = root?.latest_reply ?? null
      const readPast = latestReply !== null && reads.lastReadTs !== undefined && compareTs(reads.lastReadTs, latestReply) >= 0
      // Every reply since the read pointer is stored when coverage starts at or before it.
      const completeFrom = cursor[0]?.complete_from ?? null
      const coveredSinceRead = completeFrom !== null && reads.lastReadTs !== undefined && compareTs(completeFrom, reads.lastReadTs) <= 0
      historyComplete = complete || readPast || coveredSinceRead
      if (!complete && !readPast && latestReply !== null) unreadFloor = 1
      countersCount = root !== undefined && root.deleted === 0 ? replyCount + 1 : replyCount
      countersActivity = latestReply ?? undefined
    } else {
      const range = yield* latestSyncedRange(channel)
      const counts = yield* sql<{ has_unreads: 0 | 1; mention_count: number }>`SELECT has_unreads, mention_count FROM channel_reads WHERE channel = ${channel}`
      const kind = yield* sql<{ kind: string }>`SELECT kind FROM conversations WHERE id = ${channel}`
      historyComplete = range !== undefined && reads.lastReadTs !== undefined && compareTs(range.from_ts, reads.lastReadTs) <= 0
      if (!historyComplete && counts[0]?.has_unreads === 1) unreadFloor = 1
      const isDm = kind[0]?.kind === 'im' || kind[0]?.kind === 'mpim'
      mentionsFromCounts = !isDm && (counts[0]?.mention_count ?? 0) > 0 && counts[0]?.has_unreads === 1
    }

    const messages: Array<IndexMessage> = live.map((row) => ({
      ts: row.ts as Ts,
      ...(row.user_id === null ? {} : { userId: row.user_id as UserId }),
      text: row.text,
      get attachments(): ReadonlyArray<Attachment> | undefined {
        return row.attachments_json === null ? undefined : (JSON.parse(row.attachments_json) as ReadonlyArray<Attachment>)
      },
      get blocks(): ReadonlyArray<Block> | undefined {
        return row.blocks_json === null ? undefined : (JSON.parse(row.blocks_json) as ReadonlyArray<Block>)
      },
    }))
    const indexed = indexTopic({ messages, reads, me: options.me, lookups, senderName, historyComplete })

    const existing = (yield* sql<TopicIndexRow>`SELECT * FROM topic_index WHERE topic_id = ${id}`)[0]
    if (indexed === undefined) {
      if (existing === undefined) return false
      yield* sql`DELETE FROM topic_index WHERE topic_id = ${id}`
      yield* Invalidation.use((i) => i.invalidate(syncKeys.topic(id)))
      return true
    }

    const activity = indexed.activity
    const rootText = root !== undefined && root.deleted === 0 ? indexed.rootText?.slice(0, ROOT_TEXT_CHARS) : undefined
    const preview: StoredPreview = {
      sender: latest?.bot_name ?? indexed.preview?.sender ?? '',
      text: indexed.preview?.text ?? '',
      ...(latest?.bot_name != null || latest?.user_id === null || latest?.user_id === undefined ? {} : { senderId: latest.user_id }),
      ...(rootText === undefined ? {} : { rootText }),
    }
    const next: TopicIndexRow = {
      topic_id: id,
      channel,
      kind: parsed.kind,
      last_activity_ts: countersActivity === undefined ? activity.lastActivityTs : maxTs(activity.lastActivityTs, countersActivity),
      message_count: Math.max(activity.messageCount, countersCount),
      participants_json: JSON.stringify(activity.participants),
      root_ts: parsed.kind === 'thread' ? parsed.threadTs : (indexed.rootTs ?? null),
      unread_count: Math.max(activity.unreadCount, unreadFloor),
      unread_exact: activity.unreadExact === false ? 0 : 1,
      mentions_me: activity.mentionsMe || mentionsFromCounts ? 1 : 0,
      preview_json: JSON.stringify(preview),
      rev: existing === undefined ? 1 : existing.rev + 1,
    }
    if (existing !== undefined && sameIndexRow(existing, next)) return false

    yield* sql`INSERT INTO topic_index ${sql.insert(next as unknown as Record<string, unknown>)}
      ON CONFLICT (topic_id) DO UPDATE SET channel = excluded.channel, kind = excluded.kind, last_activity_ts = excluded.last_activity_ts,
        message_count = excluded.message_count, participants_json = excluded.participants_json, root_ts = excluded.root_ts,
        unread_count = excluded.unread_count, unread_exact = excluded.unread_exact, mentions_me = excluded.mentions_me,
        preview_json = excluded.preview_json, rev = excluded.rev`
    yield* Invalidation.use((i) => i.invalidate(syncKeys.topic(id)))
    return true
  })

function sameIndexRow(a: TopicIndexRow, b: TopicIndexRow): boolean {
  for (const key of Object.keys(a) as Array<keyof TopicIndexRow>) {
    if (key === 'rev') continue
    if (a[key] !== b[key]) return false
  }
  return true
}


/** The initial projection of a locally started thread, before its first sync reindex. */
export const indexStartedThread = (input: {
  readonly id: string; readonly channel: string; readonly root: string; readonly at: string
  readonly text: string; readonly userId: string; readonly previous?: string
}) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  if (input.previous !== undefined) yield* sql`DELETE FROM topic_index WHERE topic_id = ${input.previous}`
  yield* sql`INSERT INTO topic_index (topic_id, channel, kind, root_ts, last_activity_ts, message_count, participants_json, unread_count, unread_exact, mentions_me, preview_json, rev)
    VALUES (${input.id}, ${input.channel}, 'thread', ${input.root}, ${input.at}, 1, ${JSON.stringify([input.userId])}, 0, 1, 0,
      ${JSON.stringify({ sender: 'You', senderId: input.userId, text: input.text, rootText: input.text.slice(0, ROOT_TEXT_CHARS) })}, 1) ON CONFLICT DO NOTHING`
})
