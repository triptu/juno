/**
 * Writes to the mirror and to Juno's read state, one small function per
 * table. Every function runs on the writer connection inside a transaction
 * the caller opened, reads the current row there (so it sees the
 * transaction's own writes) and fires specific invalidation keys.
 */
import { applyServerRead, compareTs, mainTopicId, maxTs, threadTopicId, type ChannelId, type ReadState, type Ts } from '@juno/domain'
import { conversationKind, type Channel, type CountEntry, type Im, type Reaction, type Team, type User } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type ConversationRow, type MessageRow, type SqlError, type UserRow } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from './keys'

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
        thread_ts = excluded.thread_ts, user_id = excluded.user_id, subtype = excluded.subtype, text = excluded.text,
        blocks_json = excluded.blocks_json, files_json = excluded.files_json, attachments_json = excluded.attachments_json,
        edited_ts = excluded.edited_ts, deleted = excluded.deleted, client_msg_id = excluded.client_msg_id,
        reply_count = excluded.reply_count, latest_reply = excluded.latest_reply, reply_users_json = excluded.reply_users_json,
        last_event_ts = excluded.last_event_ts, version = excluded.version`
    yield* invalidate(syncKeys.messages(topicOfMessage(row)))
  })

/** The topic a message belongs to: its thread, or the channel's Main. */
export function topicOfMessage(row: Pick<MessageRow, 'channel' | 'ts' | 'thread_ts'>): string {
  const channel = row.channel as ChannelId
  return row.thread_ts !== null && row.thread_ts !== row.ts ? threadTopicId(channel, row.thread_ts as Ts) : mainTopicId(channel)
}

export const replaceReactions = (channel: string, ts: string, reactions: ReadonlyArray<Reaction>, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM reactions WHERE channel = ${channel} AND ts = ${ts}`
    for (const reaction of reactions) {
      const users = reaction.users ?? []
      yield* sql`INSERT INTO reactions (channel, ts, name, count, user_ids_json, me)
        VALUES (${channel}, ${ts}, ${reaction.name}, ${reaction.count ?? users.length}, ${JSON.stringify(users)}, ${users.includes(selfId) ? 1 : 0})`
    }
  })

/** One reaction added or removed by one user (a socket event). */
export const changeReaction = (channel: string, ts: string, name: string, user: string, added: boolean, selfId: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
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
 * `setMembership` / `replaceMembership` set the flag from `client.counts`
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

/** The full membership list (a `client.counts` without `counts_last_fetched`): exactly `ids` are members. */
export const replaceMembership = (ids: ReadonlyArray<string>): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE conversations SET is_member = 0 WHERE is_member = 1`
    yield* setMembership(ids, true)
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

interface ReadRow {
  readonly last_read_ts: string | null
  readonly marked_unread: 0 | 1
  readonly local_write_ack_ts: string | null
  readonly last_server_event_ts: string | null
}

/** Juno's read state for a topic, with the outbox checked for a pending mark. */
export const readState = (topicId: string): Effect.Effect<ReadState, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<ReadRow>`SELECT last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts FROM topic_reads WHERE topic_id = ${topicId}`
    const pending = yield* sql<{ n: number }>`SELECT count(*) AS n FROM outbox WHERE target_key = ${topicId} AND kind = 'mark'`
    const row = rows[0]
    return {
      ...(row?.last_read_ts ? { lastReadTs: row.last_read_ts as Ts } : {}),
      markedUnread: row?.marked_unread === 1,
      pendingLocalWrite: (pending[0]?.n ?? 0) > 0,
      ...(row?.local_write_ack_ts ? { localWriteAckTs: row.local_write_ack_ts as Ts } : {}),
      ...(row?.last_server_event_ts ? { lastServerEventTs: row.last_server_event_ts as Ts } : {}),
    }
  })

const writeReadState = (topicId: string, state: ReadState): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO topic_reads (topic_id, last_read_ts, marked_unread, local_write_ack_ts, last_server_event_ts)
      VALUES (${topicId}, ${state.lastReadTs ?? null}, ${state.markedUnread ? 1 : 0}, ${state.localWriteAckTs ?? null}, ${state.lastServerEventTs ?? null})
      ON CONFLICT (topic_id) DO UPDATE SET last_read_ts = excluded.last_read_ts, marked_unread = excluded.marked_unread,
        local_write_ack_ts = excluded.local_write_ack_ts, last_server_event_ts = excluded.last_server_event_ts`
    yield* invalidate(syncKeys.reads(topicId))
  })

/** The first time Juno sees a topic it takes Slack's pointer; after that Juno's own state wins. */
export const seedTopicRead = (topicId: string, lastReadTs: string): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ topic_id: string }>`SELECT topic_id FROM topic_reads WHERE topic_id = ${topicId}`
    if (rows.length > 0) return
    yield* writeReadState(topicId, { lastReadTs: lastReadTs as Ts, markedUnread: false, pendingLocalWrite: false })
  })

/**
 * A `*_marked` event from the server, applied by the conflict rule of
 * architecture 5.6: a pending local write wins; otherwise events apply in
 * `event_ts` order and never before the last local acknowledgement.
 */
export const applyServerMark = (topicId: string, lastReadTs: string, eventTs: string): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const before = yield* readState(topicId)
    const after = applyServerRead(before, { lastReadTs: lastReadTs as Ts, eventTs: eventTs as Ts })
    if (after === before) return false
    yield* writeReadState(topicId, after)
    return true
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
