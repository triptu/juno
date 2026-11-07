/**
 * Edits, deletes, reactions and broadcasts on messages (architecture 5.7,
 * specs/outbox.qnt). Each is an `outbox` row: `edit`, `delete` and
 * `broadcast` (a reply also sent to the channel) per message, `react` per
 * message and emoji. `messages.list` shows the row's
 * intent over the stored message until the row ends, so the user sees the
 * change at once and a socket event or page that lands meanwhile cannot
 * undo it. The engine's `ActionWorker` sends the rows; these functions are
 * the only writers, apart from `fileDeletes.ts` (a `deleteFile` row, keyed
 * by the file's id, so no list shows it).
 *
 * Rows are written for messages Slack has. One of Juno's own posts that is
 * still pending is handled by its state (`posts.ts`):
 *
 * - `queued` or `failed`: Slack has not got it, so nothing is sent. An edit
 *   rewrites the pending row and drops an edit row left from while the post
 *   was out; a delete removes it. A failed post takes no
 *   reaction.
 * - `sending` or `unknown`: Slack may have it. The row carries
 *   `depends_on = client_msg_id` and no ts; the worker finds the ts once
 *   the message is stored (`resolveTarget`).
 *
 * Coalescing: a newer edit replaces the row's text and bumps its `rev`; a
 * reaction row keeps the user's intent (`want`) and Slack's state when it
 * was last known (`base`), and one whose intent is back to `base` is
 * dropped unsent, so an add and a remove cancel. A delete drops the
 * message's other rows.
 */
import { Invalidation, StoreWriter, type MessageRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { messageTopics } from './keys'
import { postTopic, readPost, recordOwnDelete, removePost, requeuePost, rewritePost, type PendingPost } from './posts'

export type ActionKind = 'edit' | 'delete' | 'react' | 'broadcast' | 'deleteFile'

const KINDS: ReadonlyArray<ActionKind> = ['edit', 'delete', 'react', 'broadcast', 'deleteFile']
/** The kinds as an SQL list, for `kind IN (...)`. */
export const ACTION_KINDS_SQL = KINDS.map((kind) => `'${kind}'`).join(', ')

export interface ActionPayload {
  /** The message's ts, when Slack's ts was known when the row was written. */
  readonly ts: string | null
  readonly clientMsgId: string | null
  /** The topics that show the message, invalidated when the row changes. */
  readonly topics: ReadonlyArray<string>
  /** `edit`: the new text, its blocks, and a revision bumped by each newer edit. */
  readonly text?: string
  readonly blocksJson?: string | null
  readonly rev?: number
  /** `react`: the emoji, what the user wants, and what Slack had when last known. */
  readonly name?: string
  readonly want?: boolean
  readonly base?: boolean
  /** The action failed with this code. The row is not sent again until the user retries; the view shows what Slack has. */
  readonly failed?: string
  /** `react`: it has waited past `STALL_MILLIS` without going out, and the view says so. */
  readonly stalled?: boolean
  /** `deleteFile`: the file in Slack; `clientMsgId` is the removed post that uploaded it. */
  readonly fileId?: string
}

interface ActionFields {
  readonly id: number
  /** The row's `target_key`: the channel, or for `deleteFile` the file's id. */
  readonly channel: string
  /** The `client_msg_id` of a post Slack may not have yet. */
  readonly dependsOn: string | null
  readonly payload: ActionPayload
  readonly attempts: number
  readonly lastError: string | null
  /** Epoch millis. */
  readonly nextAt: number
  /** Epoch millis. */
  readonly createdAt: number
}

/** A change to a message (`channel` is the message's), or the delete of a file a removed post had uploaded (`fileDeletes.ts`; `channel` is the file's id). */
export type MessageAction = ActionFields & { readonly kind: Exclude<ActionKind, 'deleteFile'> }
export type FileDeleteAction = ActionFields & { readonly kind: 'deleteFile' }
export type PendingAction = MessageAction | FileDeleteAction

interface ActionRow {
  readonly id: number
  readonly kind: ActionKind
  readonly target_key: string
  readonly depends_on: string | null
  readonly payload_json: string
  readonly attempts: number
  readonly last_error: string | null
  readonly next_at: string | null
  readonly created_at: string
}

const toAction = (row: ActionRow): PendingAction =>
  ({
    id: row.id,
    kind: row.kind,
    channel: row.target_key,
    dependsOn: row.depends_on,
    payload: JSON.parse(row.payload_json) as ActionPayload,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAt: row.next_at === null ? 0 : Number(row.next_at),
    createdAt: Number(row.created_at),
  }) as PendingAction

const COLUMNS = 'id, kind, target_key, depends_on, payload_json, attempts, last_error, next_at, created_at'

export const touch = (topics: ReadonlyArray<string>) => Invalidation.use((i) => i.invalidate({ messages: [...topics] }))

/** Every pending action, oldest first. A failed action waits for the user, not the worker, and is left out. */
export const pendingActions: Effect.Effect<ReadonlyArray<PendingAction>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql.unsafe<ActionRow>(`SELECT ${COLUMNS} FROM outbox WHERE kind IN (${ACTION_KINDS_SQL}) AND json_extract(payload_json, '$.failed') IS NULL ORDER BY id`)
  return rows.map(toAction)
})


const channelActions = (channel: string): Effect.Effect<ReadonlyArray<PendingAction>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql.unsafe<ActionRow>(`SELECT ${COLUMNS} FROM outbox WHERE target_key = ? AND kind IN (${ACTION_KINDS_SQL}) ORDER BY id`, [channel])
    return rows.map(toAction)
  })

/** The row with `id` as it is now, or undefined once it ended. */
export const readAction = (id: number): Effect.Effect<PendingAction | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql.unsafe<ActionRow>(`SELECT ${COLUMNS} FROM outbox WHERE id = ?`, [id])
    return rows[0] === undefined ? undefined : toAction(rows[0])
  })

/** A message as a command names it: Slack's ts, or the `client_msg_id` of a pending post. */
export interface MessageRef {
  readonly channel: string
  /** Slack's ts, or a pending row's `pending:<client_msg_id>`. */
  readonly ts: string
  readonly clientMsgId?: string | undefined
}

/** What a reference points at now: the stored message, or a pending post. */
export type ActionTarget = { readonly kind: 'stored'; readonly row: MessageRow } | { readonly kind: 'pending'; readonly post: PendingPost }

const storedByClientMsgId = (channel: string, clientMsgId: string): Effect.Effect<MessageRow | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    // The network can post a message twice (`sent.ts`): the copy Juno kept comes first.
    const rows = yield* sql<MessageRow>`SELECT m.* FROM messages m LEFT JOIN sent_posts s ON s.client_msg_id = m.client_msg_id
      WHERE m.client_msg_id = ${clientMsgId} AND m.channel = ${channel}
      ORDER BY CASE WHEN m.ts = s.ts THEN 0 ELSE 1 END, m.ts LIMIT 1`
    return rows[0]
  })

/** The stored message a reference names, else the pending post. A stored message wins: the post has become it. */
export const resolveTarget = (ref: MessageRef): Effect.Effect<ActionTarget | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    if (!ref.ts.startsWith('pending:')) {
      const rows = yield* sql<MessageRow>`SELECT * FROM messages WHERE channel = ${ref.channel} AND ts = ${ref.ts}`
      if (rows[0] !== undefined) return { kind: 'stored', row: rows[0] }
    }
    const clientMsgId = ref.clientMsgId ?? (ref.ts.startsWith('pending:') ? ref.ts.slice('pending:'.length) : undefined)
    if (clientMsgId === undefined) return undefined
    const stored = yield* storedByClientMsgId(ref.channel, clientMsgId)
    if (stored !== undefined) return { kind: 'stored', row: stored }
    const post = yield* readPost(clientMsgId)
    return post === undefined ? undefined : { kind: 'pending', post }
  })

/** The rows that act on the message a target names. */
export const actionsOn = (target: ActionTarget): Effect.Effect<ReadonlyArray<PendingAction>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const channel = target.kind === 'stored' ? target.row.channel : target.post.channel
    const ts = target.kind === 'stored' ? target.row.ts : undefined
    const clientMsgId = target.kind === 'stored' ? target.row.client_msg_id : target.post.clientMsgId
    return (yield* channelActions(channel)).filter(
      (action) => (ts !== undefined && action.payload.ts === ts) || (clientMsgId !== null && action.payload.clientMsgId === clientMsgId),
    )
  })

export const targetFields = (target: ActionTarget): Pick<ActionPayload, 'ts' | 'clientMsgId' | 'topics'> & { readonly channel: string; readonly dependsOn: string | null } =>
  target.kind === 'stored'
    ? { channel: target.row.channel, ts: target.row.ts, clientMsgId: target.row.client_msg_id, topics: messageTopics(target.row), dependsOn: null }
    : { channel: target.post.channel, ts: null, clientMsgId: target.post.clientMsgId, topics: [postTopic(target.post)], dependsOn: target.post.clientMsgId }

export const insertAction = (kind: ActionKind, channel: string, dependsOn: string | null, payload: ActionPayload, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO outbox (kind, target_key, payload_json, depends_on, created_at, next_at)
      VALUES (${kind}, ${channel}, ${JSON.stringify(payload)}, ${dependsOn}, ${String(now)}, ${String(now)})`
    yield* touch(payload.topics)
  })

export const writePayload = (action: PendingAction, payload: ActionPayload, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET payload_json = ${JSON.stringify(payload)}, attempts = 0, created_at = ${String(now)}, next_at = ${String(now)}, last_error = NULL WHERE id = ${action.id}`
    yield* touch(payload.topics)
  })

export const deleteActions = (actions: ReadonlyArray<PendingAction>) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const action of actions) {
      yield* sql`DELETE FROM outbox WHERE id = ${action.id}`
      yield* touch(action.payload.topics)
    }
  })

/** Why a command did nothing: the message is gone (or being deleted), or it is not the user's. */
export type ActionRefusal = 'missing' | 'not-own' | 'not-sent'

export interface EditInput {
  readonly ref: MessageRef
  readonly text: string
  readonly blocksJson: string | null
  readonly selfId: string
  readonly now: number
}

/**
 * Edit: the user's own message gets `text`. A post Slack has not got is
 * rewritten in place; otherwise the message's `edit` row takes the text.
 * An edit that changes nothing writes nothing.
 */
export const queueEdit = (input: EditInput): Effect.Effect<ActionRefusal | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const target = yield* resolveTarget(input.ref)
    if (target === undefined || (target.kind === 'stored' && target.row.deleted === 1)) return 'missing'
    if (target.kind === 'stored' && target.row.user_id !== input.selfId) return 'not-own'
    const actions = yield* actionsOn(target)
    if (actions.some((action) => action.kind === 'delete')) return 'missing'
    if (target.kind === 'pending' && (target.post.state === 'queued' || target.post.state === 'failed')) {
      yield* rewritePost(target.post, input.text, input.blocksJson)
      // An edit queued while the post was out (it came back: a 429, or a lookup that did not find it) holds older
      // text, and Slack does not have the post: the post now carries the newest text, so the row goes.
      yield* deleteActions(actions.filter((action) => action.kind === 'edit'))
      return undefined
    }
    const pending = actions.find((action) => action.kind === 'edit')
    if (pending !== undefined) {
      if (pending.payload.text === input.text && pending.payload.failed === undefined) return undefined
      const { failed: _failed, ...payload } = pending.payload
      yield* writePayload(pending, { ...payload, text: input.text, blocksJson: input.blocksJson, rev: (pending.payload.rev ?? 0) + 1 }, input.now)
      return undefined
    }
    if (target.kind === 'stored' && target.row.text === input.text) return undefined
    const { channel, dependsOn, ...fields } = targetFields(target)
    yield* insertAction('edit', channel, dependsOn, { ...fields, text: input.text, blocksJson: input.blocksJson, rev: 1 }, input.now)
    return undefined
  })

export interface DeleteInput {
  readonly ref: MessageRef
  readonly selfId: string
  readonly now: number
}

/**
 * Delete: the user's own message goes. A post Slack has not got is removed;
 * otherwise a `delete` row replaces the message's other rows.
 */
export const queueDelete = (input: DeleteInput): Effect.Effect<ActionRefusal | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const target = yield* resolveTarget(input.ref)
    if (target === undefined || (target.kind === 'stored' && target.row.deleted === 1)) return 'missing'
    if (target.kind === 'stored' && target.row.user_id !== input.selfId) return 'not-own'
    const actions = yield* actionsOn(target)
    if (actions.some((action) => action.kind === 'delete')) return undefined
    yield* deleteActions(actions)
    if (target.kind === 'pending' && (target.post.state === 'queued' || target.post.state === 'failed')) {
      yield* removePost(target.post)
      return undefined
    }
    const { channel, dependsOn, ...fields } = targetFields(target)
    yield* insertAction('delete', channel, dependsOn, fields, input.now)
    return undefined
  })

/**
 * A second copy of one of Juno's posts (`sent.ts`): a `delete` row for it
 * alone. It names the copy by ts and carries no `client_msg_id`, so neither
 * the list nor the worker takes it for the message Juno kept. Answers false
 * when the copy already has one.
 */
export const queueCopyDelete = (row: MessageRow, now: number): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const actions = yield* channelActions(row.channel)
    if (actions.some((action) => action.kind === 'delete' && action.payload.ts === row.ts)) return false
    yield* insertAction('delete', row.channel, null, { ts: row.ts, clientMsgId: null, topics: messageTopics(row) }, now)
    return true
  })

// The worker's side

/**
 * Where a row's message is now. `ready`: the ts to send with. `waiting`:
 * its post may still reach Slack. `failed`: its post was refused. `gone`:
 * there is no message (a discarded post), so the row ends unsent.
 */
export type ActionPlace =
  | { readonly kind: 'ready'; readonly ts: string; readonly selfReacted?: boolean }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'failed'; readonly post: PendingPost }
  | { readonly kind: 'gone' }

export const placeOf = (action: PendingAction): Effect.Effect<ActionPlace, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (action.payload.ts !== null) return { kind: 'ready', ts: action.payload.ts }
    const clientMsgId = action.dependsOn ?? action.payload.clientMsgId
    if (clientMsgId === null) return { kind: 'gone' }
    const stored = yield* storedByClientMsgId(action.channel, clientMsgId)
    if (stored !== undefined) return stored.deleted === 1 ? { kind: 'gone' } : { kind: 'ready', ts: stored.ts }
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return { kind: 'gone' }
    return post.state === 'failed' ? { kind: 'failed', post } : { kind: 'waiting' }
  })

/**
 * Slack has not got `post` (it was refused, or came back to the queue), so
 * the rows that waited on it apply to the row, as on a queued post: an
 * edit's text goes into the row, a delete removes it (a New chat root takes
 * its waiting replies and started thread, `removePost`), and any other row
 * given, such as a reaction on a refused post, is dropped. The rows end in
 * the same transaction.
 */
export const applyWaitingActions = (post: PendingPost, actions: ReadonlyArray<PendingAction>): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (actions.some((action) => action.kind === 'delete')) {
      yield* removePost(post)
    } else {
      for (const action of actions) {
        if (action.kind === 'edit' && action.payload.text !== undefined) yield* rewritePost(post, action.payload.text, action.payload.blocksJson ?? null)
      }
    }
    yield* deleteActions(actions)
  })

/**
 * `requeuePost`, and then the edit or delete the user queued while the post
 * was out applies to it (`applyWaitingActions`), so the worker never sends
 * a post the user deleted and an edit's text goes with the post. A reaction
 * keeps waiting for the stored message. Answers whether the row was out.
 */
export const requeueUnsentPost = (clientMsgId: string, nextAt: number, error: string | null): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (!(yield* requeuePost(clientMsgId, nextAt, error))) return false
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return true
    const waiting = (yield* actionsOn({ kind: 'pending', post })).filter((action) => action.kind === 'edit' || action.kind === 'delete')
    if (waiting.length > 0) yield* applyWaitingActions(post, waiting)
    return true
  })

/**
 * After a call Slack accepted. An edit ends unless a newer edit replaced
 * its text meanwhile (`rev`); a reaction ends unless the user toggled it
 * again, in which case Slack's state becomes the new `base` and the row is
 * sent again; a delete and a broadcast always end, and the user's delete of one of Juno's
 * posts is recorded, so a network copy stored later goes too (`sent.ts`).
 * Answers whether the row ended.
 */
export const actionDone = (sent: PendingAction, now: number): Effect.Effect<boolean, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (sent.kind === 'delete' && sent.payload.clientMsgId !== null) yield* recordOwnDelete(sent.payload.clientMsgId, sent.payload.ts)
    const current = yield* readAction(sent.id)
    if (current === undefined) return true
    if (current.kind === 'edit' && current.payload.rev !== sent.payload.rev) return false
    if (current.kind === 'react' && current.payload.want !== sent.payload.want) {
      yield* writePayload(current, { ...current.payload, base: sent.payload.want ?? false }, now)
      return false
    }
    yield* deleteActions([current])
    return true
  })

/** Ends a row without a call: a refusal, a reaction back to `base`, or a message that is gone. The view shows the stored message again. */
export const dropAction = (action: PendingAction): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM outbox WHERE id = ${action.id} AND created_at = ${String(action.createdAt)} AND payload_json = ${JSON.stringify(action.payload)}`
    yield* touch(action.payload.topics)
  })

/** A call that could not reach Slack: try again at `nextAt`, counting the attempt for the backoff. */
export const deferAction = (action: PendingAction, nextAt: number, error: string): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET attempts = attempts + 1, next_at = ${String(nextAt)}, last_error = ${error} WHERE id = ${action.id} AND created_at = ${String(action.createdAt)} AND payload_json = ${JSON.stringify(action.payload)}`
  })

/** The catch-up's flush: every action row is due at `now`. */
export const flushActions = (now: number): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql.unsafe(`UPDATE outbox SET next_at = ? WHERE kind IN (${KINDS.map(() => '?').join(', ')}) AND CAST(next_at AS INTEGER) > ?`, [String(now), ...KINDS, now])
  })
