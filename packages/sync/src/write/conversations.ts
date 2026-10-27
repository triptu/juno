import { conversationKind, type Channel, type Im } from '@juno/slack-schema'
import { Invalidation, StoreWriter, type ConversationRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

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
    is_general: channel.is_general === true ? 1 : 0,
    is_ext_shared: channel.is_ext_shared === true ? 1 : 0,
    creator: channel.creator ?? null,
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
          is_archived = excluded.is_archived, topic = excluded.topic, purpose = excluded.purpose, created = excluded.created, updated = excluded.updated,
          is_general = excluded.is_general, is_ext_shared = excluded.is_ext_shared, creator = COALESCE(excluded.creator, conversations.creator)`
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
