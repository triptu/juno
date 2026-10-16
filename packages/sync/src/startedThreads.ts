/** Threads started from New chat retain their outbox identity after acknowledgement. */
import { Effect } from 'effect'
import { millisToTs } from '@juno/domain'
import { Invalidation, StoreWriter, type MessageRow } from '@juno/store'
import { indexStartedThread } from './reindex'

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
