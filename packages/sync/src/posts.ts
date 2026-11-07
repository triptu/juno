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
 * the list never shows both, in whatever order they arrive. A second
 * message with the id, which the network made, is hidden and deleted
 * (`sent.ts`).
 */
import { mainTopicId, threadTopicId, type ChannelId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { storedMe } from './me'
import { reindexTopics } from './reindex'
import { discardStartedThread } from './startedThreads'

export type PostState = 'queued' | 'sending' | 'unknown' | 'failed'

/**
 * A file that goes with a post, staged under the workspace's `uploads/`
 * folder as `stagedName`. `fileId` is Slack's id once the bytes are
 * uploaded, so a retry or a restart never uploads a file twice.
 */
export interface PendingFile {
  readonly id: string
  readonly stagedName: string
  readonly name: string
  readonly mimetype: string
  readonly size: number
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly fileId?: string | undefined
  /** Sent while the composer was still staging it: the bytes are not all here yet (`fileStaged`). */
  readonly staging?: true | undefined
}

/**
 * What a forward names (spec section 7, "Forward"): the message it shares,
 * posted with `chat.shareMessage`, and the card the list shows for it until
 * Slack's copy is stored, shaped as Slack's shared-message attachment.
 */
export interface PendingShare {
  readonly channel: string
  readonly ts: string
  readonly attachment: Readonly<Record<string, unknown>>
}

export interface PendingPost {
  readonly clientMsgId: string
  readonly channel: string
  readonly threadTs: string | undefined
  readonly text: string
  readonly blocksJson: string | null
  /** In the order they were attached. Empty for a post of text alone. */
  readonly files: ReadonlyArray<PendingFile>
  /** Set for a forward; its text and blocks are the note. */
  readonly share: PendingShare | undefined
  /** Slack's draft this message was, which the post names (`draft_id`) so Slack's other devices drop it; cleared once the post fails. */
  readonly draftId: string | undefined
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
  readonly file_ids_json: string | null
  readonly share_json: string | null
  readonly draft_id: string | null
  readonly created_at: string
  readonly state: PostState
  readonly attempts: number
  readonly next_at: number
  readonly last_error: string | null
}

const COLUMNS = 'client_msg_id, channel, thread_ts, text, blocks_json, file_ids_json, share_json, draft_id, created_at, state, attempts, next_at, last_error'

const toPost = (row: PostRow): PendingPost => ({
  clientMsgId: row.client_msg_id,
  channel: row.channel,
  threadTs: row.thread_ts ?? undefined,
  text: row.text,
  blocksJson: row.blocks_json,
  files: row.file_ids_json === null ? [] : (JSON.parse(row.file_ids_json) as ReadonlyArray<PendingFile>),
  share: row.share_json === null ? undefined : (JSON.parse(row.share_json) as PendingShare),
  draftId: row.draft_id ?? undefined,
  createdAt: Number(row.created_at),
  state: row.state,
  attempts: row.attempts,
  nextAt: row.next_at,
  lastError: row.last_error,
})

/** The topic a post shows in: its thread, or the channel's Main. */
export const postTopic = (post: Pick<PendingPost, 'channel' | 'threadTs'>): string =>
  post.threadTs === undefined ? mainTopicId(post.channel as ChannelId) : post.threadTs.startsWith('pending:') ? `p:${post.channel}:${post.threadTs.slice(8)}` : threadTopicId(post.channel as ChannelId, post.threadTs as Ts)

/** The post's topic shows it: in its list, and in its sidebar row's activity and preview (`reindex.ts`). */
const touch = (post: Pick<PendingPost, 'channel' | 'threadTs'>) =>
  Invalidation.use((i) => i.invalidate({ messages: [postTopic(post), `channel:${post.channel}`] })).pipe(Effect.andThen(reindexPostTopic(post)))

/**
 * Re-indexes the topic a post shows in, whose row counts it (`reindex.ts`).
 * A thread Juno started and Slack has not answered is indexed on its own
 * (`startedThreads.ts`).
 */
const reindexPostTopic = (post: Pick<PendingPost, 'channel' | 'threadTs'>): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (post.threadTs?.startsWith('pending:') === true) return
    const me = yield* storedMe
    if (me !== undefined) yield* reindexTopics([postTopic(post)], { me })
  })

/** The pending post with this `client_msg_id`, if any. */
export const readPost = (clientMsgId: string): Effect.Effect<PendingPost | undefined, SqlError, StoreWriter> =>
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
  readonly files?: ReadonlyArray<PendingFile>
  readonly share?: PendingShare
  readonly draftId?: string | undefined
  readonly createdAt: number
}): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    let threadTs = post.threadTs
    if (threadTs?.startsWith('pending:')) {
      const root = (yield* sql<{ root_ts: string | null }>`SELECT root_ts FROM started_threads WHERE client_msg_id = ${threadTs.slice(8)} AND channel = ${post.channel}`)[0]
      threadTs = root?.root_ts ?? threadTs
    }
    const files = post.files === undefined || post.files.length === 0 ? null : JSON.stringify(post.files)
    const share = post.share === undefined ? null : JSON.stringify(post.share)
    yield* sql`INSERT INTO pending_messages (client_msg_id, channel, thread_ts, text, blocks_json, file_ids_json, share_json, draft_id, created_at, state, attempts, next_at)
      VALUES (${post.clientMsgId}, ${post.channel}, ${threadTs ?? null}, ${post.text}, ${post.blocksJson}, ${files}, ${share}, ${post.draftId ?? null}, ${String(post.createdAt)}, 'queued', 0, ${post.createdAt})
      ON CONFLICT (client_msg_id) DO NOTHING`
    yield* touch({ channel: post.channel, threadTs })
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
 * row the user changed is in another state. A failed row no longer names
 * Slack's draft: Juno may write to the draft meanwhile, so a retry posts
 * without `draft_id` and the draft stays.
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
        last_error = ${fields.lastError === undefined ? post.lastError : fields.lastError},
        draft_id = ${to === 'failed' ? null : (post.draftId ?? null)}
      WHERE client_msg_id = ${clientMsgId}`
    if (post.state === 'failed' || to === 'failed') yield* touch(post)
    return true
  })

/**
 * `queued` to `sending`, before the one request leaves, and the post is
 * recorded as sent by `userId` (`sent.ts`). Answers the row as it is at the
 * claim, which the request is built from: the user may have edited it
 * since the worker read the queue. Undefined when the row is gone or not
 * queued.
 */
export const claimPost = (clientMsgId: string, userId: string): Effect.Effect<PendingPost | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined || !(yield* move(clientMsgId, ['queued'], 'sending', { attempt: true }))) return undefined
    yield* recordSend(clientMsgId, post.channel, userId)
    return { ...post, state: 'sending', attempts: post.attempts + 1 }
  })

/** The answer was lost: Slack may hold the message. Look it up at `nextAt`. */
export const postUnknown = (clientMsgId: string, nextAt: number, error: string) => move(clientMsgId, ['sending'], 'unknown', { nextAt, lastError: error })

/**
 * Slack did not post it and may later (rate limited, signed out), or a
 * lookup found no message: send again at `nextAt`. Slack has nothing, so
 * the worker calls this through `requeueUnsentPost` (`actions.ts`), which
 * applies an edit or delete the user queued while the post was out.
 */
export const requeuePost = (clientMsgId: string, nextAt: number, error: string | null) => move(clientMsgId, ['sending', 'unknown'], 'queued', { nextAt, lastError: error })

/** The user's edit of a post Slack has not got: the row takes the text, and shows it. */
export const rewritePost = (post: PendingPost, text: string, blocksJson: string | null): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET text = ${text}, blocks_json = ${blocksJson} WHERE client_msg_id = ${post.clientMsgId}`
    yield* touch(post)
  })

/** A lookup could not answer: ask again at `nextAt`. Counts as an attempt, so the backoff grows. */
export const deferLookup = (clientMsgId: string, nextAt: number) => move(clientMsgId, ['unknown'], 'unknown', { nextAt, attempt: true })

/**
 * Slack refuses the lookup for good (`thread_not_found`, `channel_not_found`, `is_archived`, `not_in_channel`;
 * the worker's `LOOKUP_REFUSED`): no lookup can read the message, so the row waits for Retry or Delete draft
 * instead of asking forever and holding the channel's later posts.
 */
export const failLookup = (clientMsgId: string, error: string) => move(clientMsgId, ['unknown'], 'failed', { lastError: error })

/** When the post's request last left (`recordSend`), in epoch millis; undefined when it never did. */
export const sentAt = (clientMsgId: string): Effect.Effect<number | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    return (yield* sql<{ sent_at: number }>`SELECT sent_at FROM sent_posts WHERE client_msg_id = ${clientMsgId}`)[0]?.sent_at
  })

/**
 * One of a queued post's files is in Slack: its id is kept, so the next
 * try uploads only the files still missing. False when the row is gone.
 */
export const fileUploaded = (clientMsgId: string, stagedId: string, fileId: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return false
    const files = post.files.map((file) => (file.id === stagedId ? { ...file, fileId } : file))
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET file_ids_json = ${JSON.stringify(files)} WHERE client_msg_id = ${clientMsgId}`
    // An image keeps its staged copy as the message's preview until Slack's thumbnails are stored (`files.ts`).
    const staged = files.find((file) => file.id === stagedId)
    if (staged?.width !== undefined && staged.height !== undefined && staged.mimetype.startsWith('image/') && !staged.stagedName.endsWith('.bin')) {
      const now = yield* Clock.currentTimeMillis
      yield* sql`DELETE FROM uploaded_files WHERE uploaded_at < ${now - KEEP_MILLIS}`
      yield* sql`INSERT INTO uploaded_files (file_id, staged_name, width, height, uploaded_at) VALUES (${fileId}, ${staged.stagedName}, ${staged.width}, ${staged.height}, ${now})
        ON CONFLICT (file_id) DO NOTHING`
    }
    return true
  })

/** A file the post took while it was staging is complete now: it is kept as staged, with its size. False when the row is gone. */
export const fileStaged = (clientMsgId: string, staged: PendingFile): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return false
    const files = post.files.map((file) => (file.id === staged.id ? { ...staged, ...(file.fileId === undefined ? {} : { fileId: file.fileId }) } : file))
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET file_ids_json = ${JSON.stringify(files)} WHERE client_msg_id = ${clientMsgId}`
    yield* touch(post)
    return true
  })

/** The staged copies `uploaded_files` still shows, which the staging sweep keeps. */
export const uploadedNames: Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  return (yield* sql<{ staged_name: string }>`SELECT staged_name FROM uploaded_files`).map((row) => row.staged_name)
})

/** A queued post's uploads could not reach Slack (offline, rate limited, signed out): try again at `nextAt`. */
export const deferPost = (clientMsgId: string, nextAt: number, error: string) => move(clientMsgId, ['queued'], 'queued', { nextAt, lastError: error, attempt: true })

/** A file of a queued post could not be uploaded: nothing was posted, so it waits for Retry or Delete draft. */
export const failUpload = (clientMsgId: string, error: string) => move(clientMsgId, ['queued'], 'failed', { lastError: error, attempt: true })

/**
 * A file a queued post took while it was staging will never be complete
 * (the composer could not read it, or a restart lost its bytes): the post
 * goes on without it and fails with `error`, so Retry sends what the row
 * shows and Delete draft drops it. False when the row is gone.
 */
export const failStaging = (clientMsgId: string, stagedId: string, error: string): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return false
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET file_ids_json = ${JSON.stringify(post.files.filter((file) => file.id !== stagedId))} WHERE client_msg_id = ${clientMsgId}`
    return yield* failUpload(clientMsgId, error)
  })

/** Slack refused the post. It waits for Retry or Delete draft. */
export const failPost = (clientMsgId: string, error: string) => move(clientMsgId, ['sending'], 'failed', { lastError: error })

/** Retry on a failed row: queued and due at `now`. */
export const retryPost = (clientMsgId: string, now: number) => move(clientMsgId, ['failed'], 'queued', { nextAt: now, lastError: null })

/** Delete draft on a failed row. Answers whether it was there and failed. */
export const discardPost = (clientMsgId: string): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined || post.state !== 'failed') return false
    yield* removePost(post)
    return true
  })

/**
 * Removes a post Slack has not got: Delete draft on a failed row, or the
 * user's delete of a queued one (`actions.ts`). A root started from Home
 * takes its thread and the replies that waited on it (`startedThreads.ts`).
 */
export const removePost = (post: PendingPost): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM pending_messages WHERE client_msg_id = ${post.clientMsgId}`
    if (post.threadTs === undefined) yield* discardStartedThread(post.channel, post.clientMsgId)
    yield* touch(post)
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

/** How long a sent post's row is kept. A copy shows within seconds; a week covers a long time offline. */
const KEEP_MILLIS = 7 * 24 * 60 * 60_000

/**
 * `userId` is about to send the post with `clientMsgId` to `channel` (`sent.ts`). A post sent again (after a
 * 429, or a lookup that found it absent) keeps its row and takes the new time, which bounds its next lookup.
 * Drops rows older than a week.
 */
export const recordSend = (clientMsgId: string, channel: string, userId: string): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const now = yield* Clock.currentTimeMillis
    yield* sql`DELETE FROM sent_posts WHERE sent_at < ${now - KEEP_MILLIS}`
    yield* sql`DELETE FROM kept_copies WHERE kept_at < ${now - KEEP_MILLIS}`
    yield* sql`INSERT INTO sent_posts (client_msg_id, channel, user_id, ts, sent_at) VALUES (${clientMsgId}, ${channel}, ${userId}, NULL, ${now})
      ON CONFLICT (client_msg_id) DO UPDATE SET sent_at = excluded.sent_at`
  })

/**
 * Slack applied the user's own delete of the post with `clientMsgId` (`actions.ts`). `ts` is the message
 * the delete named, or null when it named the pending post. A network copy stored later is deleted too
 * (`sent.ts`). Not for a delete of a copy Juno kept beside the message: that names another ts.
 */
export const recordOwnDelete = (clientMsgId: string, ts: string | null): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE sent_posts SET deleted_by_user = 1 WHERE client_msg_id = ${clientMsgId} AND (${ts} IS NULL OR ts IS NULL OR ts = ${ts})`
  })
