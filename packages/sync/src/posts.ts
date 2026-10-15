/**
 * The send outbox's rows (architecture 5.7, specs/outbox.qnt). A
 * `pending_messages` row is the message the list shows before Slack has it
 * and the post's place in the queue. The engine's `PostWorker` moves it
 * through its states; these functions are the only writers.
 *
 * At most once: a row is `sending` before its one request leaves, a lost
 * answer makes it `unknown`, and only a lookup that finds no message with
 * its `client_msg_id` puts it back to `queued`. A restart turns `sending`
 * into `unknown`.
 *
 * Reconciliation: every write of a message that carries a `client_msg_id`
 * (the answer, the socket echo, a history or replies page, the lookup)
 * deletes the row with that id in the same transaction (`writeMessage`), so
 * the list never shows both, in whatever order they arrive.
 */
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from './keys'

export type PostState = 'queued' | 'sending' | 'unknown' | 'failed'

export interface PendingPost {
  readonly clientMsgId: string
  readonly channel: string
  readonly threadTs: string | undefined
  readonly text: string
  readonly blocksJson: string | null
  /** Epoch millis. */
  readonly createdAt: number
  readonly state: PostState
  readonly attempts: number
  /** Epoch millis. */
  readonly nextAt: number
  readonly lastError: string | null
}

interface PostRow {
  readonly client_msg_id: string
  readonly channel: string
  readonly thread_ts: string | null
  readonly text: string
  readonly blocks_json: string | null
  readonly created_at: string
  readonly state: PostState
  readonly attempts: number
  readonly next_at: number
  readonly last_error: string | null
}

const COLUMNS = 'client_msg_id, channel, thread_ts, text, blocks_json, created_at, state, attempts, next_at, last_error'

const toPost = (row: PostRow): PendingPost => ({
  clientMsgId: row.client_msg_id,
  channel: row.channel,
  threadTs: row.thread_ts ?? undefined,
  text: row.text,
  blocksJson: row.blocks_json,
  createdAt: Number(row.created_at),
  state: row.state,
  attempts: row.attempts,
  nextAt: row.next_at,
  lastError: row.last_error,
})

/** The topic a post shows in: its thread, or the channel's Main. */
export const postTopic = (post: Pick<PendingPost, 'channel' | 'threadTs'>): string =>
  post.threadTs === undefined ? mainTopicId(post.channel as ChannelId) : threadTopicId(post.channel as ChannelId, post.threadTs as Ts)

const touch = (post: Pick<PendingPost, 'channel' | 'threadTs'>) => Invalidation.use((i) => i.invalidate(syncKeys.messages(postTopic(post))))

const readPost = (clientMsgId: string): Effect.Effect<PendingPost | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql.unsafe<PostRow>(`SELECT ${COLUMNS} FROM pending_messages WHERE client_msg_id = ?`, [clientMsgId])
    return rows[0] === undefined ? undefined : toPost(rows[0])
  })

/** A new post, `queued` and due at once. Run it in the transaction that clears the composer's draft. */
export const queuePost = (post: {
  readonly clientMsgId: string
  readonly channel: string
  readonly threadTs: string | undefined
  readonly text: string
  readonly blocksJson: string | null
  readonly createdAt: number
}): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO pending_messages (client_msg_id, channel, thread_ts, text, blocks_json, created_at, state, attempts, next_at)
      VALUES (${post.clientMsgId}, ${post.channel}, ${post.threadTs ?? null}, ${post.text}, ${post.blocksJson}, ${String(post.createdAt)}, 'queued', 0, ${post.createdAt})
      ON CONFLICT (client_msg_id) DO NOTHING`
    yield* touch(post)
  })

/** Every post not yet in Slack, oldest first. */
export const pendingPosts: Effect.Effect<ReadonlyArray<PendingPost>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql.unsafe<PostRow>(`SELECT ${COLUMNS} FROM pending_messages ORDER BY created_at, client_msg_id`)
  return rows.map(toPost)
})

/**
 * Moves a row from `from` to `to`, with the fields given. Answers whether
 * the row was in `from`: a row the echo reconciled meanwhile is gone, and a
 * row the user changed is in another state.
 */
const move = (
  clientMsgId: string,
  from: ReadonlyArray<PostState>,
  to: PostState,
  fields: { readonly nextAt?: number; readonly lastError?: string | null; readonly attempt?: boolean } = {},
): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined || !from.includes(post.state)) return false
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET
        state = ${to},
        attempts = ${post.attempts + (fields.attempt === true ? 1 : 0)},
        next_at = ${fields.nextAt ?? post.nextAt},
        last_error = ${fields.lastError === undefined ? post.lastError : fields.lastError}
      WHERE client_msg_id = ${clientMsgId}`
    if (post.state === 'failed' || to === 'failed') yield* touch(post)
    return true
  })

/** `queued` to `sending`, before the one request leaves. False when the row is gone or not queued. */
export const claimPost = (clientMsgId: string) => move(clientMsgId, ['queued'], 'sending', { attempt: true })

/** The answer was lost: Slack may hold the message. Look it up at `nextAt`. */
export const postUnknown = (clientMsgId: string, nextAt: number, error: string) => move(clientMsgId, ['sending'], 'unknown', { nextAt, lastError: error })

/** Slack did not post it and may later (rate limited, signed out), or a lookup found no message: send again at `nextAt`. */
export const requeuePost = (clientMsgId: string, nextAt: number, error: string | null) =>
  move(clientMsgId, ['sending', 'unknown'], 'queued', { nextAt, lastError: error })

/** A lookup could not answer: ask again at `nextAt`. Counts as an attempt, so the backoff grows. */
export const deferLookup = (clientMsgId: string, nextAt: number) => move(clientMsgId, ['unknown'], 'unknown', { nextAt, attempt: true })

/** Slack refused the post. It waits for Retry or Delete draft. */
export const failPost = (clientMsgId: string, error: string) => move(clientMsgId, ['sending'], 'failed', { lastError: error })

/** Retry on a failed row: queued and due at `now`. */
export const retryPost = (clientMsgId: string, now: number) => move(clientMsgId, ['failed'], 'queued', { nextAt: now, lastError: null })

/** Delete draft on a failed row. Answers whether it was there and failed. */
export const discardPost = (clientMsgId: string): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined || post.state !== 'failed') return false
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM pending_messages WHERE client_msg_id = ${clientMsgId}`
    yield* touch(post)
    return true
  })

/** After a restart: a row left `sending` may have reached Slack, so it is `unknown`, due at `now`. */
export const recoverPosts = (now: number): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET state = 'unknown', next_at = ${now} WHERE state = 'sending'`
  })

/** The catch-up's flush: every `queued` and `unknown` row is due at `now`. */
export const flushPosts = (now: number): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET next_at = ${now} WHERE state IN ('queued', 'unknown') AND next_at > ${now}`
  })

/**
 * Reconciliation: the message with this `client_msg_id` is stored, so its
 * pending row goes. `writeMessage` calls it in the same transaction.
 */
export const reconcilePost = (clientMsgId: string): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM pending_messages WHERE client_msg_id = ${clientMsgId}`
  })
