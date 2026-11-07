/** Threads started from New chat retain their outbox identity after acknowledgement. */
import { Clock, Effect } from 'effect'
import { millisToTs } from '@juno/domain'
import { Invalidation, StoreWriter, type MessageRow } from '@juno/store'
import { queueFileDeletes } from './fileDeletes'
import type { PendingFile } from './posts'
import { ROOT_TEXT_CHARS } from './reindex'

const startedTopicId = (channel: string, clientMsgId: string) => `p:${channel}:${clientMsgId}`

export const startThread = (input: { readonly channel: string; readonly clientMsgId: string; readonly text: string; readonly createdAt: number }) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const id = startedTopicId(input.channel, input.clientMsgId)
    const root = `pending:${input.clientMsgId}`
    const at = millisToTs(input.createdAt)
    const self = (yield* sql<{ self_user_id: string }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? ''
    yield* sql`INSERT INTO started_threads (client_msg_id, channel, topic_id, created_at)
      VALUES (${input.clientMsgId}, ${input.channel}, ${id}, ${input.createdAt}) ON CONFLICT DO NOTHING`
    yield* indexStartedThread({ id, channel: input.channel, root, at, text: input.text, userId: self })
    yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed) VALUES (${input.channel}, ${root}, 1) ON CONFLICT DO NOTHING`
    yield* Invalidation.use(i => i.invalidate(['topics', 'thread_subs']))
    return id
  })

/**
 * The root of a thread started from Home goes before Slack has it (Delete
 * draft on a refused root, or a delete of a queued one): the thread never
 * existed. The replies that waited on it (`thread_ts` `pending:<id>`) go
 * with it, as do its topic and its local follow. Answers whether there was
 * such a thread. Their staged files are left to the staging sweep.
 */
export const discardStartedThread = (channel: string, clientMsgId: string) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const started = (yield* sql<{ topic_id: string; root_ts: string | null }>`SELECT topic_id, root_ts FROM started_threads
    WHERE client_msg_id = ${clientMsgId} AND channel = ${channel}`)[0]
  if (started === undefined || started.root_ts !== null) return false
  const root = `pending:${clientMsgId}`
  // The waiting replies go with the root, and the files they had uploaded are deleted in Slack (`fileDeletes.ts`).
  const replies = yield* sql<{ client_msg_id: string; file_ids_json: string | null }>`SELECT client_msg_id, file_ids_json FROM pending_messages WHERE channel = ${channel} AND thread_ts = ${root}`
  yield* sql`DELETE FROM pending_messages WHERE channel = ${channel} AND thread_ts = ${root}`
  const now = yield* Clock.currentTimeMillis
  for (const reply of replies) {
    if (reply.file_ids_json !== null) yield* queueFileDeletes({ clientMsgId: reply.client_msg_id, files: JSON.parse(reply.file_ids_json) as ReadonlyArray<PendingFile> }, now)
  }
  yield* sql`DELETE FROM started_threads WHERE client_msg_id = ${clientMsgId} AND channel = ${channel}`
  yield* sql`DELETE FROM topic_index WHERE topic_id = ${started.topic_id}`
  yield* sql`DELETE FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${root}`
  yield* Invalidation.use(i => i.invalidate(['topics', 'thread_subs']))
  yield* Invalidation.use(i => i.invalidate({ messages: [started.topic_id] }))
  return true
})

/** Called before storing an echo or post response, in the same transaction. */
export const acknowledgeStartedThread = (message: MessageRow) => Effect.gen(function* () {
  if (message.client_msg_id === null) return message
  const sql = yield* StoreWriter
  const rows = yield* sql<{ topic_id: string; root_ts: string | null }>`SELECT topic_id, root_ts FROM started_threads
    WHERE client_msg_id = ${message.client_msg_id} AND channel = ${message.channel}`
  const started = rows[0]
  if (started === undefined || (started.root_ts !== null && started.root_ts !== message.ts)) return message
  const id = `t:${message.channel}:${message.ts}`
  if (started.root_ts === null) {
    yield* sql`UPDATE started_threads SET root_ts = ${message.ts} WHERE client_msg_id = ${message.client_msg_id}`
    yield* sql`UPDATE pending_messages SET thread_ts = ${message.ts}
      WHERE channel = ${message.channel} AND thread_ts = ${`pending:${message.client_msg_id}`}`
    yield* sql`DELETE FROM thread_subs WHERE channel = ${message.channel} AND thread_ts = ${`pending:${message.client_msg_id}`}`
    yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed) VALUES (${message.channel}, ${message.ts}, 1) ON CONFLICT DO NOTHING`
    yield* Invalidation.use(i => i.invalidate(['topics', 'thread_subs']))
  }
  yield* indexStartedThread({ id, channel: message.channel, root: message.ts, at: message.ts, text: message.text, userId: message.user_id ?? '', previous: started.topic_id })
  return { ...message, thread_ts: message.ts }
})

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
