/**
 * Field-level merge rules (ADR 0011, architecture 5.4). Pages, socket events,
 * search matches and echoes arrive in any order, so every write goes through
 * `mergeMessage` and the guards decide field by field:
 *
 * - A tombstone always wins.
 * - `reply_count` and `latest_reply` take the maximum.
 * - An edit applies only if its `edited_ts` is newer than the stored one;
 *   content without an edit marker never replaces edited content.
 * - Reaction state from a page applies only if the message's `last_event_ts`
 *   is older than the page's request start. Reaction events are applied by
 *   the caller and only bump `last_event_ts`.
 * - A stub root (a reply arrived before its root) keeps the counters it
 *   learned and is filled in by whichever page brings the root.
 *
 * Nothing here touches the store; `write.ts` reads the existing row and
 * writes the result.
 */
import { compareTs, maxTs, type Message } from '@juno/slack-schema'
import type { Flag, MessageRow } from '@juno/store'

/** Where an incoming message came from, for the reaction guard and `last_event_ts`. */
export type MergeSource =
  /** A history, replies, thread view or search page. `requestedAt` is the ts of the request start. */
  | { readonly kind: 'page'; readonly requestedAt: string }
  /** A socket event. */
  | { readonly kind: 'event'; readonly eventTs: string }

export interface MergeResult {
  readonly row: MessageRow
  /** False when the stored row already says everything the incoming one does. */
  readonly changed: boolean
  /** The caller should replace the message's reaction rows with `incoming.reactions`. */
  readonly applyReactions: boolean
}

const TOMBSTONE = 'tombstone'

const json = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value))
const flag = (value: boolean): Flag => (value ? 1 : 0)

/** True when a message of a page or event is a deleted root (Slack keeps the row). */
export const isTombstone = (message: Pick<Message, 'subtype'>): boolean => message.subtype === TOMBSTONE

/** A row for a message the store has never seen. */
export function toMessageRow(channel: string, message: Message): MessageRow {
  const deleted = isTombstone(message)
  return {
    channel,
    ts: message.ts,
    thread_ts: message.thread_ts ?? null,
    user_id: message.user ?? message.bot_id ?? null,
    subtype: message.subtype ?? null,
    text: deleted ? '' : (message.text ?? ''),
    blocks_json: deleted ? null : json(message.blocks),
    files_json: deleted ? null : json(message.files),
    attachments_json: deleted ? null : json(message.attachments),
    edited_ts: message.edited?.ts ?? null,
    deleted: flag(deleted),
    client_msg_id: message.client_msg_id ?? null,
    reply_count: message.reply_count ?? 0,
    latest_reply: message.latest_reply ?? null,
    reply_users_json: json(message.reply_users),
    last_event_ts: null,
    version: 0,
  }
}

/** A root the store does not have yet, known only from one of its replies. */
export function stubRoot(channel: string, threadTs: string, reply: Pick<Message, 'ts' | 'user'>): MessageRow {
  return {
    channel,
    ts: threadTs,
    thread_ts: threadTs,
    user_id: null,
    subtype: null,
    text: '',
    blocks_json: null,
    files_json: null,
    attachments_json: null,
    edited_ts: null,
    deleted: 0,
    client_msg_id: null,
    reply_count: 1,
    latest_reply: reply.ts,
    reply_users_json: reply.user === undefined ? null : JSON.stringify([reply.user]),
    last_event_ts: null,
    version: 0,
  }
}

const sameRow = (a: MessageRow, b: MessageRow): boolean => {
  for (const key of Object.keys(a) as Array<keyof MessageRow>) {
    if (key === 'version') continue
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Merges an incoming message into the stored row by the rules above. */
export function mergeMessage(existing: MessageRow | undefined, incoming: Message, channel: string, source: MergeSource): MergeResult {
  const fresh = toMessageRow(channel, incoming)
  if (existing === undefined) {
    const row = source.kind === 'event' ? { ...fresh, last_event_ts: source.eventTs } : fresh
    return { row, changed: true, applyReactions: incoming.reactions !== undefined && !row.deleted }
  }

  const eventTs = source.kind === 'event' ? source.eventTs : undefined
  const lastEventTs = eventTs === undefined ? existing.last_event_ts : existing.last_event_ts === null ? eventTs : maxTs(existing.last_event_ts, eventTs)

  // A tombstone always wins; a tombstoned row only learns counters.
  if (existing.deleted === 1 || fresh.deleted === 1) {
    const row: MessageRow = {
      ...existing,
      thread_ts: existing.thread_ts ?? fresh.thread_ts,
      text: '',
      blocks_json: null,
      files_json: null,
      attachments_json: null,
      deleted: 1,
      reply_count: Math.max(existing.reply_count, fresh.reply_count),
      latest_reply: maxNullable(existing.latest_reply, fresh.latest_reply),
      last_event_ts: lastEventTs,
    }
    return finish(existing, row, false)
  }

  // Content: an edit applies only when newer; unedited content never replaces an edit.
  const incomingEdit = fresh.edited_ts
  const storedEdit = existing.edited_ts
  const takeContent =
    storedEdit === null ? true : incomingEdit !== null && compareTs(incomingEdit, storedEdit) >= 0
  // A stub root has no content at all; any page fills it.
  const isStub = existing.user_id === null && existing.text === '' && existing.blocks_json === null
  const content = takeContent || isStub ? fresh : existing

  const replyCount = Math.max(existing.reply_count, fresh.reply_count)
  const row: MessageRow = {
    channel,
    ts: existing.ts,
    thread_ts: fresh.thread_ts ?? existing.thread_ts,
    user_id: fresh.user_id ?? existing.user_id,
    subtype: content.subtype ?? existing.subtype,
    text: content.text,
    blocks_json: content.blocks_json,
    files_json: content.files_json,
    attachments_json: content.attachments_json,
    edited_ts: takeContent ? (incomingEdit ?? storedEdit) : storedEdit,
    deleted: 0,
    client_msg_id: fresh.client_msg_id ?? existing.client_msg_id,
    reply_count: replyCount,
    latest_reply: maxNullable(existing.latest_reply, fresh.latest_reply),
    reply_users_json: fresh.reply_count >= existing.reply_count && fresh.reply_users_json !== null ? fresh.reply_users_json : existing.reply_users_json,
    last_event_ts: lastEventTs,
    version: existing.version,
  }

  // Reactions from a page apply only if no event touched the message after the request started.
  const applyReactions =
    incoming.reactions !== undefined &&
    (source.kind === 'event' || existing.last_event_ts === null || compareTs(existing.last_event_ts, source.requestedAt) < 0)
  return finish(existing, row, applyReactions)
}

/** Marks a message deleted. The row stays so a thread keeps its place. */
export function mergeTombstone(existing: MessageRow | undefined, channel: string, ts: string, source: MergeSource): MergeResult {
  const base: MessageRow = existing ?? {
    channel,
    ts,
    thread_ts: null,
    user_id: null,
    subtype: null,
    text: '',
    blocks_json: null,
    files_json: null,
    attachments_json: null,
    edited_ts: null,
    deleted: 0,
    client_msg_id: null,
    reply_count: 0,
    latest_reply: null,
    reply_users_json: null,
    last_event_ts: null,
    version: 0,
  }
  const row: MessageRow = {
    ...base,
    text: '',
    blocks_json: null,
    files_json: null,
    attachments_json: null,
    deleted: 1,
    last_event_ts: source.kind === 'event' ? maxNullable(base.last_event_ts, source.eventTs) : base.last_event_ts,
  }
  return existing === undefined ? { row, changed: true, applyReactions: false } : finish(existing, row, false)
}

export interface RootCounters {
  readonly reply_count?: number
  readonly latest_reply?: string
  readonly reply_users?: ReadonlyArray<string>
}

/** `message_replied` and search matches: counters take the maximum, never a smaller value. */
export function mergeRootCounters(existing: MessageRow, counters: RootCounters, source: MergeSource): MergeResult {
  const replyCount = Math.max(existing.reply_count, counters.reply_count ?? 0)
  const row: MessageRow = {
    ...existing,
    thread_ts: existing.thread_ts ?? existing.ts,
    reply_count: replyCount,
    latest_reply: maxNullable(existing.latest_reply, counters.latest_reply ?? null),
    reply_users_json:
      counters.reply_users !== undefined && (counters.reply_count ?? 0) >= existing.reply_count ? JSON.stringify(counters.reply_users) : existing.reply_users_json,
    last_event_ts: source.kind === 'event' ? maxNullable(existing.last_event_ts, source.eventTs) : existing.last_event_ts,
  }
  return finish(existing, row, false)
}

function finish(existing: MessageRow, row: MessageRow, applyReactions: boolean): MergeResult {
  const changed = !sameRow(existing, row)
  return { row: changed ? { ...row, version: existing.version + 1 } : existing, changed, applyReactions }
}

function maxNullable(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return maxTs(a, b)
}
