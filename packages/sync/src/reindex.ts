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
 * A topic whose inputs have not changed since its row was last computed is
 * not computed again (`topicInputs.ts`).
 *
 * What the pure rule cannot know is added here from the mirror:
 * - a thread whose replies are not all stored takes `message_count` and
 *   `last_activity_ts` from the root's counters and reports `unread_exact`
 *   as false unless the read pointer is at or past `latest_reply`;
 * - Main takes `has_unreads` and `mention_count` from `client.counts` and is
 *   exact only when a synced range covers everything since the read pointer.
 * - A Main with no stored message and no synced range yet can be provisional:
 *   `client.counts`' `latest` is its activity, its unread flag is a dot and
 *   its preview is empty. The cold boot asks for one (`provisionalMain`) for
 *   every conversation active in the window, so channels and DMs show before
 *   their history lands; a stored row with `message_count = 0` is
 *   provisional and keeps following `channel_reads` until history or an
 *   event replaces it, or a synced range without Main messages removes it.
 *   Until a synced range exists, a Main with messages keeps at least the
 *   activity `client.counts` reported, so a search preview does not move it down.
 * - Ephemeral messages are left out: they never set a row's preview,
 *   activity, unread count or mention.
 */
import {
  compareTs,
  indexTopic,
  maxTs,
  namesakes,
  parseTopicId,
  UNKNOWN_PERSON,
  type IndexInput,
  type IndexMessage,
  type Me,
  type ReadState,
  type Ts,
  type UserId,
} from '@juno/domain'
import type { Attachment, Block, File } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type MessageRow, type SqlError, type TopicIndexRow } from '@juno/store'
import { Effect } from 'effect'
import { messageTopics, syncKeys } from './keys'
import { countExact } from './threadRanges'
import { markUpToDate, storedRow, topicInputs } from './topicInputs'
import { latestSyncedRange, readState, threadMessages, threadRanges } from './write'

export interface ReindexOptions {
  readonly me: Me
  /** A sender or a mention had no row in `users`. The caller fetches the user and re-indexes the topic. */
  readonly onMissingUser?: (userId: string, topicId: string) => void
  /** A user group mention had no row in `usergroups`. The caller re-indexes the topic once the groups arrive. */
  readonly onMissingUsergroup?: (topicId: string) => void
  /** Give a Main with nothing stored a provisional row from `client.counts` (cold boot). An existing provisional row is kept without it. */
  readonly provisionalMain?: boolean
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
  /** Other people who wrote in the topic with the sender's first name, so the row can add a last initial ("Alex K"). */
  readonly namesakes?: ReadonlyArray<string>
}

/** How many of the topic's latest distinct senders are checked for a sender's namesakes. */
const NAMESAKE_WINDOW = 50

/** Enough of a root for `firstWords`, never a whole message. */
export const ROOT_TEXT_CHARS = 240

const MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g
const CHANNEL_MENTION = /<#([A-Z0-9]+)(?:\|[^>]*)?>/g
const USERGROUP_MENTION = /<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g

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

/** Every topic the index knows, computed again whatever its mark says: a full rebuild. */
export const reindexAll = (options: ReindexOptions): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM topic_inputs`
    const rows = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_index`
    return yield* reindexTopics(rows.map((r) => r.topic_id), options)
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

    const reads = yield* readState(id)
    const inputs = topicInputs(options.me, reads)
    const { row: existing, upToDate } = yield* storedRow(id, inputs)
    if (upToDate) return false
    // Set when the row looked for someone not stored: it gets no marker, so the next re-index looks again.
    let complete = true
    const settle = (changed: boolean) => Effect.as(complete ? markUpToDate(id, inputs) : Effect.void, changed)

    const rows: ReadonlyArray<MessageRow> =
      parsed.kind === 'thread'
        ? yield* threadMessages(channel, parsed.threadTs)
        : yield* sql<MessageRow>`
            SELECT * FROM messages WHERE channel = ${channel}
              AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')`
    const root = parsed.kind === 'thread' ? rows.find((r) => r.ts === parsed.threadTs) : undefined

    // Names for the preview: the latest live message's sender and mentions. The root's text is stored raw and named at read time.
    // An ephemeral message (Slackbot's notes) shows in the topic but is never its latest, unread or mention.
    const live = rows.filter((r) => r.deleted === 0 && r.ephemeral !== 1)
    let latest: MessageRow | undefined
    for (const row of live) if (latest === undefined || compareTs(row.ts, latest.ts) > 0) latest = row
    const userIds = new Set<string>()
    const channelIds = new Set<string>()
    const usergroupIds = new Set<string>()
    if (latest !== undefined) {
      if (latest.user_id !== null) userIds.add(latest.user_id)
      for (const match of latest.text.matchAll(MENTION)) userIds.add(match[1]!)
      for (const match of latest.text.matchAll(CHANNEL_MENTION)) channelIds.add(match[1]!)
      for (const match of latest.text.matchAll(USERGROUP_MENTION)) usergroupIds.add(match[1]!)
    }
    const users = new Map<string, string>()
    const loadUsers = (ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        if (ids.length === 0) return 0
        const found = yield* sql<{ id: string; display_name: string | null; real_name: string | null; name: string | null }>`
          SELECT id, display_name, real_name, name FROM users WHERE id IN ${sql.in(ids)}`
        for (const user of found) users.set(user.id, user.display_name ?? user.real_name ?? user.name ?? user.id)
        return found.length
      })
    yield* loadUsers([...userIds])
    const channels = new Map<string, string>()
    if (channelIds.size > 0) {
      const found = yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in([...channelIds])}`
      for (const c of found) if (c.name !== null) channels.set(c.id, c.name)
    }
    const usergroups = new Map<string, { readonly handle: string; readonly name?: string }>()
    if (usergroupIds.size > 0) {
      const found = yield* sql<{ id: string; handle: string; name: string | null }>`SELECT id, handle, name FROM usergroups WHERE id IN ${sql.in([...usergroupIds])}`
      for (const group of found) usergroups.set(group.id, { handle: group.handle, ...(group.name === null ? {} : { name: group.name }) })
      if (found.length < usergroupIds.size) {
        complete = false
        options.onMissingUsergroup?.(id)
      }
    }
    // The rule also names people in other messages (mentions in unread ones, blocks, attachments). It asks
    // through `lookups`; names not loaded above are noted here and looked up after.
    const asked = new Set<string>()
    const missing = (userId: string) => {
      asked.add(userId)
      return undefined
    }
    const lookups: IndexInput['lookups'] = {
      me: options.me.userId,
      user: (userId) => users.get(userId) ?? missing(userId),
      channel: (channelId) => channels.get(channelId),
      usergroup: (groupId) => usergroups.get(groupId),
      ...(options.me.usergroupIds === undefined ? {} : { myUsergroups: options.me.usergroupIds }),
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
      const latestReply = root?.latest_reply ?? null
      // Exact only when a proven range reaches from the read pointer to the end (`threadRanges.ts`): the stored
      // replies reaching `reply_count` prove nothing, since a reply can raise the count without the gap filling.
      const ranges = yield* threadRanges(channel, parsed.threadTs)
      historyComplete = countExact(ranges, reads.lastReadTs ?? parsed.threadTs, latestReply ?? undefined)
      if (!historyComplete && latestReply !== null) unreadFloor = 1
      countersCount = root !== undefined && root.deleted === 0 ? replyCount + 1 : replyCount
      countersActivity = latestReply ?? undefined
    } else {
      const range = yield* latestSyncedRange(channel)
      const counts = yield* sql<{ has_unreads: 0 | 1; mention_count: number; latest: string | null }>`SELECT has_unreads, mention_count, latest FROM channel_reads WHERE channel = ${channel}`
      const kind = yield* sql<{ kind: string }>`SELECT kind FROM conversations WHERE id = ${channel}`
      // Before history, the stored messages (a search preview, an event) may be older than the activity `client.counts`
      // reported, and the row must not drop down the list until its history lands.
      if (range === undefined) countersActivity = counts[0]?.latest ?? undefined
      historyComplete = range !== undefined && reads.lastReadTs !== undefined && compareTs(range.from_ts, reads.lastReadTs) <= 0
      if (!historyComplete && counts[0]?.has_unreads === 1) unreadFloor = 1
      const isDm = kind[0]?.kind === 'im' || kind[0]?.kind === 'mpim'
      mentionsFromCounts = !isDm && (counts[0]?.mention_count ?? 0) > 0 && counts[0]?.has_unreads === 1
    }

    const attentionContext = JSON.stringify(options.me)
    const messages: Array<IndexMessage> = live.map((row) => ({
      ts: row.ts as Ts,
      ...(row.attention_context === attentionContext && (row.attention === 0 || row.attention === 1 || row.attention === 2) ? { attention: row.attention } : {}),
      ...(row.user_id === null ? {} : { userId: row.user_id as UserId }),
      ...(row.subtype === null ? {} : { subtype: row.subtype }),
      text: row.text,
      get attachments(): ReadonlyArray<Attachment> | undefined {
        return row.attachments_json === null ? undefined : (JSON.parse(row.attachments_json) as ReadonlyArray<Attachment>)
      },
      get blocks(): ReadonlyArray<Block> | undefined {
        return row.blocks_json === null ? undefined : (JSON.parse(row.blocks_json) as ReadonlyArray<Block>)
      },
      get files(): ReadonlyArray<File> | undefined {
        return row.files_json === null ? undefined : (JSON.parse(row.files_json) as ReadonlyArray<File>)
      },
    }))
    let indexed = indexTopic({ messages, reads, me: options.me, lookups, senderName, historyComplete, includeAttention: true })
    if (asked.size > 0) {
      const requested = [...asked]
      asked.clear()
      // Stored people the first pass did not load: run the rule again with their names.
      if ((yield* loadUsers(requested)) > 0) indexed = indexTopic({ messages, reads, me: options.me, lookups, senderName, historyComplete, includeAttention: true })
      // Only a person with no `users` row is missing. Asking for a stored one would re-index this topic and ask again, without end.
      for (const userId of requested) {
        if (users.has(userId)) continue
        complete = false
        options.onMissingUser?.(userId, id)
      }
    }

    const attention = new Map<string, number>(indexed?.attention?.map((item) => [item.ts, item.kind]))
    // Reuse annotations for unchanged content and membership. Each unread body is parsed only when that cache is missing.
    for (const value of [0, 1, 2]) {
      const changed = live.filter((row) => attention.get(row.ts) === value && (row.attention !== value || row.attention_context !== attentionContext)).map((row) => row.ts)
      for (let offset = 0; offset < changed.length; offset += 200) {
        yield* sql`UPDATE messages SET attention = ${value}, attention_context = ${attentionContext} WHERE channel = ${channel} AND ts IN ${sql.in(changed.slice(offset, offset + 200))}`
      }
    }

    if (indexed === undefined && parsed.kind === 'main' && live.length === 0 && (options.provisionalMain === true || existing?.message_count === 0)) {
      const provisional = yield* provisionalMain(id, channel, reads, existing)
      if (provisional !== undefined) return yield* settle(yield* writeRow(id, provisional, existing))
    }
    if (indexed === undefined) {
      if (existing === undefined) return false
      yield* sql`DELETE FROM topic_index WHERE topic_id = ${id}`
      yield* Invalidation.use((i) => i.invalidate(syncKeys.topic(id)))
      return true
    }

    const activity = indexed.activity
    const namesakeCheck = latest?.bot_name == null && latest?.user_id != null ? yield* senderNamesakes(latest.user_id, live, options.me.userId) : undefined
    if (namesakeCheck?.complete === false) complete = false
    const sakes = namesakeCheck?.names ?? []
    const rootText = root !== undefined && root.deleted === 0 ? indexed.rootText?.slice(0, ROOT_TEXT_CHARS) : undefined
    const preview: StoredPreview = {
      sender: latest?.bot_name ?? indexed.preview?.sender ?? '',
      text: indexed.preview?.text ?? '',
      ...(latest?.bot_name != null || latest?.user_id === null || latest?.user_id === undefined ? {} : { senderId: latest.user_id }),
      ...(rootText === undefined ? {} : { rootText }),
      ...(sakes.length === 0 ? {} : { namesakes: sakes }),
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
    return yield* settle(yield* writeRow(id, next, existing))
  })

/**
 * The people among the topic's latest senders who share the sender's first name. Usually none. `complete` is false
 * when a sender has no `users` row: one stored later could be a namesake.
 */
const senderNamesakes = (
  senderId: string,
  live: ReadonlyArray<MessageRow>,
  me: string,
): Effect.Effect<{ readonly names: ReadonlyArray<string>; readonly complete: boolean }, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const ids = new Set<string>([senderId])
    for (const row of live.toSorted((a, b) => compareTs(b.ts, a.ts))) {
      if (ids.size > NAMESAKE_WINDOW) break
      if (row.user_id !== null && row.user_id !== me) ids.add(row.user_id)
    }
    if (ids.size < 2) return { names: [], complete: true }
    const sql = yield* StoreWriter
    const found = yield* sql<{ id: string; display_name: string | null; real_name: string | null; name: string | null }>`
      SELECT id, display_name, real_name, name FROM users WHERE id IN ${sql.in([...ids])}`
    const people = found.map((user) => ({ id: user.id, name: user.display_name ?? user.real_name ?? user.name ?? '' }))
    const sender = people.find((person) => person.id === senderId)
    return { names: sender === undefined ? [] : namesakes(sender, people), complete: found.length === ids.size }
  })

/** Writes `next` unless it equals `existing`, bumping `rev`, and fires the topic's key. */
const writeRow = (id: string, next: TopicIndexRow, existing: TopicIndexRow | undefined): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if (existing !== undefined && sameIndexRow(existing, next)) return false
    yield* sql`INSERT INTO topic_index ${sql.insert(next as unknown as Record<string, unknown>)}
      ON CONFLICT (topic_id) DO UPDATE SET channel = excluded.channel, kind = excluded.kind, last_activity_ts = excluded.last_activity_ts,
        message_count = excluded.message_count, participants_json = excluded.participants_json, root_ts = excluded.root_ts,
        unread_count = excluded.unread_count, unread_exact = excluded.unread_exact, mentions_me = excluded.mentions_me,
        preview_json = excluded.preview_json, rev = excluded.rev`
    yield* Invalidation.use((i) => i.invalidate(syncKeys.topic(id)))
    return true
  })

/**
 * A Main row from `client.counts` alone, before any of its messages are
 * stored: activity at `latest`, unread as a dot while Slack says it has
 * unreads past Juno's pointer, no preview. Undefined once a synced range
 * exists (history found no Main message) or when counts gave no `latest`.
 */
const provisionalMain = (
  id: string,
  channel: string,
  reads: ReadState,
  existing: TopicIndexRow | undefined,
): Effect.Effect<TopicIndexRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if ((yield* latestSyncedRange(channel)) !== undefined) return undefined
    const counts = (yield* sql<{ latest: string | null; has_unreads: 0 | 1; mention_count: number; kind: string | null }>`
      SELECT r.latest, r.has_unreads, r.mention_count, c.kind FROM channel_reads r LEFT JOIN conversations c ON c.id = r.channel
      WHERE r.channel = ${channel}`)[0]
    if (counts === undefined || counts.latest === null) return undefined
    const pointer = reads.lastReadTs
    const unread = reads.markedUnread || (counts.has_unreads === 1 && (pointer === undefined || compareTs(counts.latest, pointer) > 0))
    const isDm = counts.kind === 'im' || counts.kind === 'mpim'
    const preview: StoredPreview = { sender: '', text: '' }
    return {
      topic_id: id,
      channel,
      kind: 'main',
      last_activity_ts: counts.latest,
      message_count: 0,
      participants_json: '[]',
      root_ts: null,
      unread_count: unread ? 1 : 0,
      unread_exact: unread ? 0 : 1,
      mentions_me: unread && !isDm && counts.mention_count > 0 ? 1 : 0,
      preview_json: JSON.stringify(preview),
      rev: existing === undefined ? 1 : existing.rev + 1,
    }
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
