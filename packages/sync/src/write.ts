/**
 * Writes to the mirror and to Juno's read state, one small function per
 * table. Every function runs on the writer connection inside a transaction
 * the caller opened, reads the current row there (so it sees the
 * transaction's own writes) and fires specific invalidation keys.
 */
import {
  acknowledgeLocalWrite,
  compareTs,
  emptyReadState,
  mainTopicId,
  maxTs,
  observeServerRead,
  rejectLocalWrite,
  threadTopicId,
  type ChannelId,
  type ReadOutcome,
  type ReadState,
  type ServerRead,
  type Ts,
} from '@juno/domain'
import { conversationKind, type Channel, type CountEntry, type Im, type Reaction, type Team, type User } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type ConversationRow, type MessageRow, type SqlError, type UserRow } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from './keys'
import { reconcilePost } from './posts'

type Writer = Effect.Effect<void, SqlError, StoreWriter | Invalidation>

const invalidate = (keys: Parameters<Invalidation['Service']['invalidate']>[0]) => Invalidation.use((i) => i.invalidate(keys))

// Messages

export const readMessage = (channel: string, ts: string): Effect.Effect<MessageRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${channel} AND ts = ${ts}`
    return rows[0]
  })

export const writeMessage = (row: MessageRow): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO messages ${sql.insert(row as unknown as Record<string, unknown>)}
      ON CONFLICT (channel, ts) DO UPDATE SET
        thread_ts = excluded.thread_ts, user_id = excluded.user_id, bot_name = excluded.bot_name, bot_icon = excluded.bot_icon, subtype = excluded.subtype, text = excluded.text,
        blocks_json = excluded.blocks_json, files_json = excluded.files_json, attachments_json = excluded.attachments_json,
        edited_ts = excluded.edited_ts, deleted = excluded.deleted, client_msg_id = excluded.client_msg_id,
        reply_count = excluded.reply_count, latest_reply = excluded.latest_reply, reply_users_json = excluded.reply_users_json,
        last_event_ts = excluded.last_event_ts, version = excluded.version`
    // Whichever of the answer, the echo or a page stores Juno's own message first ends its pending row (5.7).
    if (row.client_msg_id !== null) yield* reconcilePost(row.client_msg_id)
    yield* invalidate(syncKeys.messagesOf(row))
  })

/** The topic a message belongs to: its thread, or the channel's Main. */
export function topicOfMessage(row: Pick<MessageRow, 'channel' | 'ts' | 'thread_ts'>): string {
  const channel = row.channel as ChannelId
  return row.thread_ts !== null && row.thread_ts !== row.ts ? threadTopicId(channel, row.thread_ts as Ts) : mainTopicId(channel)
}

type ReactionTarget = Pick<MessageRow, 'channel' | 'ts' | 'thread_ts' | 'subtype' | 'reply_count'>

/** A message's reactions as a page states them. Fires the message's topics, whose rows show the reactions. */
export const replaceReactions = (message: ReactionTarget, reactions: ReadonlyArray<Reaction>, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const { channel, ts } = message
    yield* sql`DELETE FROM reactions WHERE channel = ${channel} AND ts = ${ts}`
    for (const reaction of reactions) {
      const users = reaction.users ?? []
      yield* sql`INSERT INTO reactions (channel, ts, name, count, user_ids_json, me)
        VALUES (${channel}, ${ts}, ${reaction.name}, ${reaction.count ?? users.length}, ${JSON.stringify(users)}, ${users.includes(selfId) ? 1 : 0})`
    }
    yield* invalidate(syncKeys.messagesOf(message))
  })

/** One reaction added or removed by one user (a socket event). Fires the message's topics. */
export const changeReaction = (message: ReactionTarget, name: string, user: string, added: boolean, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const { channel, ts } = message
    yield* invalidate(syncKeys.messagesOf(message))
    const rows = yield* sql<{ user_ids_json: string | null }>`SELECT user_ids_json FROM reactions WHERE channel = ${channel} AND ts = ${ts} AND name = ${name}`
    const current = rows[0] === undefined ? [] : (JSON.parse(rows[0].user_ids_json ?? '[]') as Array<string>)
    const users = added ? (current.includes(user) ? current : [...current, user]) : current.filter((u) => u !== user)
    if (users.length === 0) {
      yield* sql`DELETE FROM reactions WHERE channel = ${channel} AND ts = ${ts} AND name = ${name}`
    } else {
      yield* sql`INSERT INTO reactions (channel, ts, name, count, user_ids_json, me)
        VALUES (${channel}, ${ts}, ${name}, ${users.length}, ${JSON.stringify(users)}, ${users.includes(selfId) ? 1 : 0})
        ON CONFLICT (channel, ts, name) DO UPDATE SET count = excluded.count, user_ids_json = excluded.user_ids_json, me = excluded.me`
    }
  })

// Users, conversations, team

const displayName = (user: User): string | null => {
  const display = user.profile?.display_name?.trim()
  if (display) return display
  const real = user.profile?.real_name?.trim() || user.real_name?.trim()
  if (real) return real
  return user.name ?? null
}

export const toUserRow = (user: User): UserRow => ({
  id: user.id,
  name: user.name ?? null,
  display_name: displayName(user),
  real_name: user.profile?.real_name ?? user.real_name ?? null,
  avatar_url: user.profile?.image_72 ?? user.profile?.image_48 ?? user.profile?.image_192 ?? null,
  tz: user.tz ?? null,
  is_bot: user.is_bot === true ? 1 : 0,
  deleted: user.deleted === true ? 1 : 0,
  updated: user.updated === undefined ? null : String(user.updated),
})

export const upsertUsers = (users: ReadonlyArray<User>): Writer =>
  Effect.gen(function* () {
    if (users.length === 0) return
    const sql = yield* StoreWriter
    for (const user of users) {
      const row = toUserRow(user)
      yield* sql`INSERT INTO users ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name, real_name = excluded.real_name,
          avatar_url = excluded.avatar_url, tz = excluded.tz, is_bot = excluded.is_bot, deleted = excluded.deleted, updated = excluded.updated`
    }
    yield* invalidate(syncKeys.users)
  })

/**
 * The metadata of a conversation object. Membership is not part of it:
 * `client.userBoot` lists every channel of the workspace without
 * `is_member` (observed live), so a new row starts as not a member and
 * `storeMembership` in metadata.ts sets the flag from `client.counts`
 * and the membership events.
 */
export const toConversationRow = (c: Channel | Im): ConversationRow => {
  const channel = c as Channel
  const kind = 'user' in c && !('is_channel' in c) ? 'im' : conversationKind(channel)
  const members = channel.members
  return {
    id: c.id,
    kind,
    name: channel.name ?? null,
    user_id: kind === 'im' ? ((c as Im).user ?? null) : null,
    member_ids_json: members === undefined ? null : JSON.stringify(members),
    is_member: 0,
    is_archived: channel.is_archived === true ? 1 : 0,
    topic: channel.topic?.value ?? null,
    purpose: channel.purpose?.value ?? null,
    created: c.created === undefined ? null : String(c.created),
    updated: c.updated === undefined ? null : String(c.updated),
  }
}

/** Inserts or refreshes the metadata of conversations. A row that exists keeps its `is_member`. */
export const upsertConversations = (rows: ReadonlyArray<ConversationRow>): Writer =>
  Effect.gen(function* () {
    if (rows.length === 0) return
    const sql = yield* StoreWriter
    for (const row of rows) {
      yield* sql`INSERT INTO conversations ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, user_id = excluded.user_id,
          member_ids_json = COALESCE(excluded.member_ids_json, conversations.member_ids_json),
          is_archived = excluded.is_archived, topic = excluded.topic, purpose = excluded.purpose, created = excluded.created, updated = excluded.updated`
    }
    yield* invalidate(syncKeys.conversations)
  })

const MEMBERSHIP_BATCH = 500

/** Marks conversations the user is (or is no longer) in. Ids without a row are ignored. */
export const setMembership = (ids: ReadonlyArray<string>, member: boolean): Writer =>
  Effect.gen(function* () {
    if (ids.length === 0) return
    const sql = yield* StoreWriter
    const flag = member ? 1 : 0
    for (let i = 0; i < ids.length; i += MEMBERSHIP_BATCH) {
      yield* sql`UPDATE conversations SET is_member = ${flag} WHERE id IN ${sql.in(ids.slice(i, i + MEMBERSHIP_BATCH))} AND is_member <> ${flag}`
    }
    yield* invalidate(syncKeys.conversations)
  })

/** A partial update from a channel event: only the given columns change. */
export const patchConversation = (id: string, patch: Partial<Omit<ConversationRow, 'id'>>): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
    if (entries.length === 0) return
    const rows = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${id}`
    if (rows.length === 0) return
    yield* sql`UPDATE conversations SET ${sql.update(Object.fromEntries(entries))} WHERE id = ${id}`
    yield* invalidate(syncKeys.conversations)
  })

export const upsertTeam = (team: Team, selfId: string, prefs: unknown, bootedAt: number | undefined): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const existing = yield* sql<{ booted_at: string | null; prefs_json: string | null }>`SELECT booted_at, prefs_json FROM team WHERE id = ${team.id}`
    const booted = bootedAt === undefined ? (existing[0]?.booted_at ?? null) : String(bootedAt)
    const prefsJson = prefs === undefined ? (existing[0]?.prefs_json ?? null) : JSON.stringify(prefs)
    yield* sql`INSERT INTO team (id, name, domain, self_user_id, enterprise_id, prefs_json, booted_at)
      VALUES (${team.id}, ${team.name}, ${team.domain}, ${selfId}, ${team.enterprise_id ?? null}, ${prefsJson}, ${booted})
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, domain = excluded.domain, self_user_id = excluded.self_user_id,
        enterprise_id = excluded.enterprise_id, prefs_json = excluded.prefs_json, booted_at = excluded.booted_at`
    yield* invalidate(syncKeys.team)
  })

export const setPref = (name: string, value: unknown): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: string; prefs_json: string | null }>`SELECT id, prefs_json FROM team`
    const team = rows[0]
    if (team === undefined) return
    const prefs = (team.prefs_json === null ? {} : JSON.parse(team.prefs_json)) as Record<string, unknown>
    prefs[name] = value
    yield* sql`UPDATE team SET prefs_json = ${JSON.stringify(prefs)} WHERE id = ${team.id}`
    yield* invalidate(syncKeys.team)
  })

// Read state and subscriptions

export const setChannelReads = (entries: ReadonlyArray<CountEntry>, countsUpdated: number): Writer =>
  Effect.gen(function* () {
    if (entries.length === 0) return
    const sql = yield* StoreWriter
    for (const entry of entries) {
      yield* sql`INSERT INTO channel_reads (channel, slack_last_read, latest, has_unreads, mention_count, counts_updated)
        VALUES (${entry.id}, ${entry.last_read}, ${entry.latest ?? null}, ${entry.has_unreads ? 1 : 0}, ${entry.mention_count}, ${String(countsUpdated)})
        ON CONFLICT (channel) DO UPDATE SET slack_last_read = excluded.slack_last_read, latest = excluded.latest,
          has_unreads = excluded.has_unreads, mention_count = excluded.mention_count, counts_updated = excluded.counts_updated`
    }
    yield* invalidate(syncKeys.channelReads)
  })

export interface ThreadSubRow {
  readonly subscribed: boolean
  readonly slackLastRead?: string
  /** Slack's `event_ts` of the last socket event that wrote the row. */
  readonly updatedEventTs?: string
  /** Juno's clock when the row was last observed or changed: a page's request start, an event's arrival, a command and its end. */
  readonly observedAt?: string
  /** A Juno command wrote the row at some point, so a follow event that contradicts it is checked with Slack. */
  readonly commanded: boolean
}

/** Slack's follow state for a thread as the store knows it; `undefined` when Slack has said nothing. */
export const threadSub = (channel: string, threadTs: string): Effect.Effect<ThreadSubRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ subscribed: 0 | 1; slack_last_read: string | null; updated_event_ts: string | null; observed_at: string | null; commanded: 0 | 1 }>`
      SELECT subscribed, slack_last_read, updated_event_ts, observed_at, commanded FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    const row = rows[0]
    if (row === undefined) return undefined
    return {
      subscribed: row.subscribed === 1,
      commanded: row.commanded === 1,
      ...(row.slack_last_read === null ? {} : { slackLastRead: row.slack_last_read }),
      ...(row.updated_event_ts === null ? {} : { updatedEventTs: row.updated_event_ts }),
      ...(row.observed_at === null ? {} : { observedAt: row.observed_at }),
    }
  })

/**
 * Who says the follow flag changed, and when (the sync README, "Follow
 * state", has the whole rule):
 *
 * - `event`: a socket event. `eventTs` is Slack's clock and orders events
 *   among themselves; `observedAt` is Juno's clock at arrival.
 * - `page`: a `getView` row, a root on a history or replies page, or a root
 *   lookup. `requestedAt` is Juno's clock when the request started; the page
 *   applies only when that is after the row's `observedAt`.
 * - `command`: Juno's own Subscribe or Unsubscribe, at `at` on Juno's clock.
 *
 * While a command on the thread is pending (an outbox row of kind
 * `follow`), events and pages do not change the flag; they mark the row
 * `seen` so the command refreshes from Slack after its acknowledgement.
 *
 * An event's `event_ts` cannot be ordered against Juno's own command: a
 * frame Slack sent before it accepted the command can arrive after the
 * command's answer. So an event that contradicts a row a command wrote is
 * not applied; the caller asks Slack for the root instead (`lookup`).
 */
export type ThreadSubSource =
  | { readonly kind: 'event'; readonly eventTs: string; readonly observedAt: string }
  | { readonly kind: 'page'; readonly requestedAt: string }
  | { readonly kind: 'command'; readonly at: string }

/** What `setThreadSub` did: wrote the row, left it alone, or found an event it cannot order, so Slack should be asked for the root. */
export type ThreadSubOutcome = 'applied' | 'ignored' | 'lookup'

/** Writes Slack's follow state for a thread. Fires `thread_subs`, which the sidebar query subscribes to. */
export const setThreadSub = (
  channel: string,
  threadTs: string,
  subscribed: boolean,
  slackLastRead: string | undefined,
  source: ThreadSubSource,
): Effect.Effect<ThreadSubOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const existing = yield* threadSub(channel, threadTs)
    if (source.kind === 'event' && existing?.updatedEventTs !== undefined && compareTs(source.eventTs, existing.updatedEventTs) < 0) return 'ignored'
    if (source.kind === 'page' && existing?.observedAt !== undefined && compareTs(source.requestedAt, existing.observedAt) <= 0) return 'ignored'
    if (source.kind !== 'command' && (yield* notePendingFollow(channel, threadTs))) return 'ignored'
    if (source.kind === 'event' && existing?.commanded === true && existing.subscribed !== subscribed) return 'lookup'
    const at = source.kind === 'event' ? source.observedAt : source.kind === 'page' ? source.requestedAt : source.at
    const observedAt = existing?.observedAt === undefined ? at : maxTs(existing.observedAt, at)
    const eventTs = source.kind === 'event' ? source.eventTs : (existing?.updatedEventTs ?? null)
    const commanded = source.kind === 'command' || existing?.commanded === true ? 1 : 0
    yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed, slack_last_read, updated_event_ts, observed_at, commanded)
      VALUES (${channel}, ${threadTs}, ${subscribed ? 1 : 0}, ${slackLastRead ?? null}, ${eventTs}, ${observedAt}, ${commanded})
      ON CONFLICT (channel, thread_ts) DO UPDATE SET subscribed = excluded.subscribed,
        slack_last_read = COALESCE(excluded.slack_last_read, thread_subs.slack_last_read),
        updated_event_ts = excluded.updated_event_ts, observed_at = excluded.observed_at, commanded = excluded.commanded`
    const changed = existing?.subscribed !== subscribed || (slackLastRead !== undefined && existing.slackLastRead !== slackLastRead)
    if (changed) yield* invalidate(syncKeys.threadSubs)
    return 'applied'
  })

/**
 * The `subscribed` and `last_read` a root carries on a page (history,
 * replies and thread views all send them live, research section 3). `true`
 * sets the flag, `false` clears a stored follow, and a root that says
 * nothing changes nothing. A `false` for a thread Slack never mentioned
 * stays unknown, so the sidebar's mention rule still applies to it.
 */
export const applyRootSubscription = (
  channel: string,
  root: { readonly ts: string; readonly subscribed?: boolean; readonly last_read?: string },
  requestedAt: string,
): Effect.Effect<ThreadSubOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (root.subscribed === undefined) return 'ignored'
    if (root.subscribed === false && (yield* threadSub(channel, root.ts)) === undefined) return 'ignored'
    return yield* setThreadSub(channel, root.ts, root.subscribed, root.subscribed ? root.last_read : undefined, { kind: 'page', requestedAt })
  })

/** The topic id an outbox row of kind `follow` targets. */
const followTarget = (channel: string, threadTs: string) => threadTopicId(channel as ChannelId, threadTs as Ts)

/**
 * Juno's Subscribe or Unsubscribe is in flight for a thread: one outbox row
 * of kind `follow` per thread, written in the command's transaction and
 * removed by `endPendingFollow`. Not retried yet (the full outbox is a later
 * milestone); `clearPendingFollows` drops rows a crash left behind.
 */
export const beginPendingFollow = (channel: string, threadTs: string, subscribed: boolean, at: number): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at)
      VALUES ('follow', ${followTarget(channel, threadTs)}, ${JSON.stringify({ subscribed, seen: false })}, ${String(at)})`
  })

/**
 * Ends the pending command on a thread, `at` the command's answer (or
 * failure) on Juno's clock. The row's `observed_at` moves to `at`: a page
 * requested while the command was pending may show Slack from before it
 * accepted the command, so it must not apply after the answer either.
 * Returns whether Slack said anything about the thread meanwhile.
 */
export const endPendingFollow = (channel: string, threadTs: string, at: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const target = followTarget(channel, threadTs)
    const rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    yield* sql`DELETE FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    const sub = yield* threadSub(channel, threadTs)
    if (sub !== undefined) {
      const observedAt = sub.observedAt === undefined ? at : maxTs(sub.observedAt, at)
      yield* sql`UPDATE thread_subs SET observed_at = ${observedAt} WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    }
    return rows.some((row) => (JSON.parse(row.payload_json) as { seen?: boolean }).seen === true)
  })

/** True, and the observation noted, when a command on the thread is pending. */
const notePendingFollow = (channel: string, threadTs: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const target = followTarget(channel, threadTs)
    const rows = yield* sql<{ id: number }>`SELECT id FROM outbox WHERE kind = 'follow' AND target_key = ${target}`
    if (rows.length === 0) return false
    yield* sql`UPDATE outbox SET payload_json = json_set(payload_json, '$.seen', json('true')) WHERE kind = 'follow' AND target_key = ${target}`
    return true
  })

/** At sync start: no command is in flight, so `follow` rows are left over from a crash. */
export const clearPendingFollows: Effect.Effect<void, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  yield* sql`DELETE FROM outbox WHERE kind = 'follow'`
})

/** Forgets a `thread_subs` row (the revert of a first subscribe), so Slack's silence is stored as silence again. */
export const clearThreadSub = (channel: string, threadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${threadTs}`
    yield* invalidate(syncKeys.threadSubs)
  })

/** What the store knows about a thread's coverage: all replies, or all replies from `completeFrom` on. */
export const markRepliesComplete = (channel: string, threadTs: string, complete: boolean, syncedAt: number, completeFrom?: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO thread_cursors (channel, thread_ts, replies_complete, synced_at, complete_from)
      VALUES (${channel}, ${threadTs}, ${complete ? 1 : 0}, ${String(syncedAt)}, ${completeFrom ?? null})
      ON CONFLICT (channel, thread_ts) DO UPDATE SET replies_complete = excluded.replies_complete, synced_at = excluded.synced_at,
        complete_from = CASE
          WHEN excluded.complete_from IS NULL THEN thread_cursors.complete_from
          WHEN thread_cursors.complete_from IS NULL THEN excluded.complete_from
          WHEN excluded.complete_from < thread_cursors.complete_from THEN excluded.complete_from
          ELSE thread_cursors.complete_from END`
  })

/**
 * The socket dropped: replies sent during the gap may never arrive as
 * events, so "every reply from `complete_from` on is stored" stops being
 * known for threads the user does not follow. Followed threads keep it: the
 * reconnect pages `getView` over every thread with activity since the store
 * was last in step and marks their coverage again from Slack's pointer, and
 * a followed thread with no activity since then missed nothing.
 */
export const endEventCoverage: Effect.Effect<void, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  yield* sql`UPDATE thread_cursors SET complete_from = NULL
    WHERE complete_from IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM thread_subs s WHERE s.channel = thread_cursors.channel AND s.thread_ts = thread_cursors.thread_ts AND s.subscribed = 1)`
})

// Read state (architecture 5.6, specs/readstate.qnt). The rules are `@juno/domain`'s
// `observeServerRead` and the local marks; these functions load and store their state.

interface ReadRow {
  readonly last_read_ts: string | null
  readonly marked_unread: 0 | 1
  readonly local_write_ack_ts: string | null
  readonly last_server_event_ts: string | null
  readonly observed_at: string | null
  readonly slack_read_ts: string | null
  readonly commanded: 0 | 1
}

/** What a pending `mark` outbox row sends. */
interface MarkPayload {
  /** The pointer Slack will have. */
  readonly ts: string
  readonly unread: boolean
  /** Mark unread on a thread: the first unread reply, which `subscriptions.thread.mark` takes with `read: 0`. */
  readonly from?: string
  /** Bumped by every local mark that replaces the intent, so the worker knows its answer is for an older one. */
  readonly gen: number
  /** Slack said something about the topic while the mark was pending. */
  readonly seen: boolean
}

/** A topic's pending mark: the one `outbox` row of kind `mark` for it. */
export interface PendingMark {
  readonly topicId: string
  readonly lastReadTs: Ts
  readonly unread: boolean
  readonly from?: Ts
  readonly gen: number
  readonly seen: boolean
  readonly attempts: number
  /** Epoch milliseconds when the worker may send it. */
  readonly nextAt: number
}

const MARK = 'mark'

const toPendingMark = (row: { target_key: string; payload_json: string; attempts: number; next_at: string | null }): PendingMark => {
  const payload = JSON.parse(row.payload_json) as MarkPayload
  return {
    topicId: row.target_key,
    lastReadTs: payload.ts as Ts,
    unread: payload.unread,
    ...(payload.from === undefined ? {} : { from: payload.from as Ts }),
    gen: payload.gen,
    seen: payload.seen,
    attempts: row.attempts,
    nextAt: row.next_at === null ? 0 : Number(row.next_at),
  }
}

/** The pending mark of a topic, if any. */
export const pendingMark = (topicId: string): Effect.Effect<PendingMark | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ target_key: string; payload_json: string; attempts: number; next_at: string | null }>`
      SELECT target_key, payload_json, attempts, next_at FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    return rows[0] === undefined ? undefined : toPendingMark(rows[0])
  })

/** Every pending mark, the earliest due first. */
export const pendingMarks: Effect.Effect<ReadonlyArray<PendingMark>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<{ target_key: string; payload_json: string; attempts: number; next_at: string | null }>`
    SELECT target_key, payload_json, attempts, next_at FROM outbox WHERE kind = ${MARK} ORDER BY CAST(next_at AS INTEGER), id`
  return rows.map(toPendingMark)
})

/** Juno's read state for a topic, with its pending mark. */
export const readState = (topicId: string): Effect.Effect<ReadState, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<ReadRow>`
      SELECT last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded
      FROM topic_reads WHERE topic_id = ${topicId}`
    const row = rows[0]
    const mark = yield* pendingMark(topicId)
    return {
      ...(row?.last_read_ts ? { lastReadTs: row.last_read_ts as Ts } : {}),
      markedUnread: row?.marked_unread === 1,
      pendingLocalWrite: mark !== undefined,
      ...(mark === undefined ? {} : { intent: { lastReadTs: mark.lastReadTs, unread: mark.unread } }),
      ...(row?.local_write_ack_ts ? { localWriteAckTs: row.local_write_ack_ts as Ts } : {}),
      ...(row?.last_server_event_ts ? { lastServerEventTs: row.last_server_event_ts as Ts } : {}),
      ...(row?.observed_at ? { observedAt: row.observed_at as Ts } : {}),
      ...(row?.slack_read_ts ? { slackReadTs: row.slack_read_ts as Ts } : {}),
      commanded: row?.commanded === 1,
    }
  })

const writeReadState = (topicId: string, state: ReadState): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO topic_reads (topic_id, last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts, observed_at, slack_read_ts, commanded)
      VALUES (${topicId}, ${state.lastReadTs ?? null}, ${state.markedUnread ? 1 : 0}, ${state.localWriteAckTs ?? null},
        ${state.lastServerEventTs ?? null}, ${state.observedAt ?? null}, ${state.slackReadTs ?? null}, ${state.commanded === true ? 1 : 0})
      ON CONFLICT (topic_id) DO UPDATE SET last_read_ts = excluded.last_read_ts, marked_unread = excluded.marked_unread,
        local_write_ack_ts = excluded.local_write_ack_ts, last_server_event_ts = excluded.last_server_event_ts,
        observed_at = excluded.observed_at, slack_read_ts = excluded.slack_read_ts, commanded = excluded.commanded`
    yield* invalidate(syncKeys.reads(topicId))
  })

/**
 * Cold boot only: a thread the user does not follow starts read at
 * `lastReadTs` the first time Juno sees it. Slack keeps no pointer for such
 * a thread, so this is Juno's own and Slack's stays unknown.
 */
export const seedTopicRead = (topicId: string, lastReadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topicId}`
    if (rows.length > 0) return
    yield* writeReadState(topicId, { ...emptyReadState, lastReadTs: lastReadTs as Ts })
  })

/**
 * Slack's pointer for a topic from an event or a page, applied by
 * `observeServerRead`. A first sight takes Slack's pointer. `noted` marks
 * the pending mark so the engine asks Slack after it ends; `lookup` asks
 * the caller to ask Slack now (`readLookups` for Main, the root for a
 * thread). The caller re-indexes the topic when the outcome is `applied`.
 */
export const observeRead = (topicId: string, read: ServerRead): Effect.Effect<ReadOutcome, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const before = yield* readState(topicId)
    const { state, outcome } = observeServerRead(before, read)
    if (outcome === 'applied') yield* writeReadState(topicId, state)
    if (outcome === 'noted') {
      const sql = yield* StoreWriter
      yield* sql`UPDATE outbox SET payload_json = json_set(payload_json, '$.seen', json('true')) WHERE kind = ${MARK} AND target_key = ${topicId}`
    }
    return outcome
  })

/**
 * A local mark (`markReadLocally` or `markUnreadLocally` made `state`): the
 * state, and for a mirrored mark its outbox row, in the caller's
 * transaction. A row already pending takes the new intent (marks coalesce to
 * the last) and keeps its due time; a new row is due `delayMillis` after
 * `now`, so marks in quick succession make one call.
 */
export const writeLocalMark = (topicId: string, state: ReadState, from: Ts | undefined, now: number, delayMillis: number): Writer =>
  Effect.gen(function* () {
    yield* writeReadState(topicId, state)
    if (!state.pendingLocalWrite || state.intent === undefined) return
    const sql = yield* StoreWriter
    const existing = yield* pendingMark(topicId)
    const payload: MarkPayload = {
      ts: state.intent.lastReadTs,
      unread: state.intent.unread,
      ...(from === undefined ? {} : { from }),
      gen: (existing?.gen ?? 0) + 1,
      seen: existing?.seen ?? false,
    }
    if (existing === undefined) {
      yield* sql`INSERT INTO outbox (kind, target_key, payload_json, created_at, next_at)
        VALUES (${MARK}, ${topicId}, ${JSON.stringify(payload)}, ${String(now)}, ${String(now + delayMillis)})`
    } else {
      yield* sql`UPDATE outbox SET payload_json = ${JSON.stringify(payload)} WHERE kind = ${MARK} AND target_key = ${topicId}`
    }
  })

/**
 * Slack accepted `sent`, the mark of generation `gen` with Slack's new
 * pointer, answered at `at` (Juno's clock). When no newer local mark
 * replaced it, the row ends; `seen` says Slack said something meanwhile, so
 * the caller asks Slack. Otherwise the row stays, due now, and is sent
 * again with its newer intent.
 */
export const endMark = (
  topicId: string,
  sent: { readonly gen: number; readonly lastReadTs: Ts },
  at: Ts,
): Effect.Effect<{ readonly done: boolean; readonly seen: boolean }, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const mark = yield* pendingMark(topicId)
    const done = mark === undefined || mark.gen === sent.gen
    if (mark !== undefined && done) yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    if (!done) yield* sql`UPDATE outbox SET attempts = 0, next_at = ${String(0)}, last_error = NULL WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* writeReadState(topicId, acknowledgeLocalWrite(yield* readState(topicId), sent.lastReadTs, at, done))
    return { done, seen: done && mark?.seen === true }
  })

/**
 * Slack refused the mark of generation `gen` at `at`. When no newer mark
 * replaced it, the row ends and Slack's pointer is no longer known, so the
 * caller asks Slack and its answer applies. Returns whether the row ended.
 */
export const rejectMark = (topicId: string, gen: number, at: Ts): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const mark = yield* pendingMark(topicId)
    if (mark === undefined) return false
    if (mark.gen !== gen) {
      yield* sql`UPDATE outbox SET next_at = ${String(0)} WHERE kind = ${MARK} AND target_key = ${topicId}`
      return false
    }
    yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* writeReadState(topicId, rejectLocalWrite(yield* readState(topicId), at))
    return true
  })

/** A transient failure: the row keeps its intent and is due again at `nextAt` (epoch milliseconds). */
export const deferMark = (topicId: string, nextAt: number, error: string): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET attempts = attempts + 1, next_at = ${String(nextAt)}, last_error = ${error} WHERE kind = ${MARK} AND target_key = ${topicId}`
  })

/** Mirroring was turned off: the row is dropped and the mark stays local. */
export const dropMark = (topicId: string): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM outbox WHERE kind = ${MARK} AND target_key = ${topicId}`
    yield* invalidate(syncKeys.reads(topicId))
  })

// Overlay

interface OverlayRow {
  readonly resolved_at: string | null
  readonly resolved_activity_ts: string | null
}

/** Activity after a resolve clears it and sets the Reopened tag (architecture 4.4). */
export const reopenIfResolved = (topicId: string, activityTs: string, now: number): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<OverlayRow>`SELECT resolved_at, resolved_activity_ts FROM topic_overlay WHERE topic_id = ${topicId}`
    const row = rows[0]
    if (row === undefined || row.resolved_at === null) return
    if (row.resolved_activity_ts !== null && compareTs(activityTs, row.resolved_activity_ts) <= 0) return
    yield* sql`UPDATE topic_overlay SET resolved_at = NULL, resolved_activity_ts = NULL, reopened_at = ${String(now)} WHERE topic_id = ${topicId}`
    yield* invalidate(syncKeys.overlay(topicId))
  })

/**
 * The overlay columns a command changes, as stored. A key that is present
 * sets its column; `null` clears it. The undo of a change is the patch of
 * the same keys with the values from before it.
 */
export interface OverlayPatch {
  readonly manualTitle?: string | null
  readonly resolvedAt?: string | null
  readonly resolvedActivityTs?: string | null
  readonly reopenedAt?: string | null
  readonly pinnedAt?: string | null
}

const overlayColumns = {
  manualTitle: 'manual_title',
  resolvedAt: 'resolved_at',
  resolvedActivityTs: 'resolved_activity_ts',
  reopenedAt: 'reopened_at',
  pinnedAt: 'pinned_at',
} as const satisfies Record<keyof OverlayPatch, string>

type OverlayKey = keyof typeof overlayColumns
type StoredOverlay = Record<OverlayKey, string | null>

/** The topic's overlay columns that commands change, all null when it has no row. */
export const readOverlay = (topicId: string): Effect.Effect<StoredOverlay, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<Record<(typeof overlayColumns)[OverlayKey], string | null>>`
      SELECT manual_title, resolved_at, resolved_activity_ts, reopened_at, pinned_at FROM topic_overlay WHERE topic_id = ${topicId}`
    const row = rows[0]
    return {
      manualTitle: row?.manual_title ?? null,
      resolvedAt: row?.resolved_at ?? null,
      resolvedActivityTs: row?.resolved_activity_ts ?? null,
      reopenedAt: row?.reopened_at ?? null,
      pinnedAt: row?.pinned_at ?? null,
    }
  })

/**
 * Applies `patch` to the topic's overlay and returns the patch that undoes
 * it, or `undefined` when nothing changed.
 */
export const patchOverlay = (topicId: string, patch: OverlayPatch): Effect.Effect<OverlayPatch | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const before = yield* readOverlay(topicId)
    const undo: Partial<Record<OverlayKey, string | null>> = {}
    const after: StoredOverlay = { ...before }
    for (const key of Object.keys(overlayColumns) as OverlayKey[]) {
      const value = patch[key]
      if (value === undefined || value === before[key]) continue
      undo[key] = before[key]
      after[key] = value
    }
    if (Object.keys(undo).length === 0) return undefined
    const sql = yield* StoreWriter
    yield* sql`
      INSERT INTO topic_overlay (topic_id, manual_title, resolved_at, resolved_activity_ts, reopened_at, pinned_at)
      VALUES (${topicId}, ${after.manualTitle}, ${after.resolvedAt}, ${after.resolvedActivityTs}, ${after.reopenedAt}, ${after.pinnedAt})
      ON CONFLICT (topic_id) DO UPDATE SET manual_title = excluded.manual_title, resolved_at = excluded.resolved_at,
        resolved_activity_ts = excluded.resolved_activity_ts, reopened_at = excluded.reopened_at, pinned_at = excluded.pinned_at`
    yield* invalidate(syncKeys.overlay(topicId))
    return undo
  })

// Ignored channels

/** Ignores a channel (`at` is when) or stops ignoring it (`null`). Returns whether anything changed. */
export const setIgnored = (channel: string, at: string | null): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ channel: string }>`SELECT channel FROM ignored_channels WHERE channel = ${channel}`
    if ((rows.length > 0) === (at !== null)) return false
    if (at === null) yield* sql`DELETE FROM ignored_channels WHERE channel = ${channel}`
    else yield* sql`INSERT INTO ignored_channels (channel, ignored_at) VALUES (${channel}, ${at})`
    yield* invalidate(syncKeys.ignored)
    return true
  })

/** The synced range a page covered, merged with the ranges it touches. */
export const addSyncedRange = (channel: string, fromTs: string, toTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const touching = yield* sql<{ from_ts: string; to_ts: string }>`
      SELECT from_ts, to_ts FROM synced_ranges WHERE channel = ${channel} AND from_ts <= ${toTs} AND to_ts >= ${fromTs}`
    let from = fromTs
    let to = toTs
    for (const r of touching) {
      if (compareTs(r.from_ts, from) < 0) from = r.from_ts
      if (compareTs(r.to_ts, to) > 0) to = r.to_ts
    }
    if (touching.length > 0) {
      yield* sql`DELETE FROM synced_ranges WHERE channel = ${channel} AND from_ts IN ${sql.in(touching.map((r) => r.from_ts))}`
    }
    yield* sql`INSERT INTO synced_ranges (channel, from_ts, to_ts) VALUES (${channel}, ${from}, ${to})`
  })

export const latestSyncedRange = (channel: string): Effect.Effect<{ from_ts: string; to_ts: string } | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ from_ts: string; to_ts: string }>`
      SELECT from_ts, to_ts FROM synced_ranges WHERE channel = ${channel} ORDER BY to_ts DESC LIMIT 1`
    return rows[0]
  })

export const getSyncState = <A>(key: string): Effect.Effect<A | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = ${key}`
    const row = rows[0]
    return row === undefined ? undefined : (JSON.parse(row.value_json) as A)
  })

export const setSyncState = (key: string, value: unknown): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO sync_state (key, value_json) VALUES (${key}, ${JSON.stringify(value)})
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
  })

/** Message rows of a thread: the root and every reply. */
export const threadMessages = (channel: string, threadTs: string): Effect.Effect<ReadonlyArray<MessageRow>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${channel} AND (ts = ${threadTs} OR thread_ts = ${threadTs})`
  })
