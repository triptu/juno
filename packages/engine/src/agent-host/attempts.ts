/**
 * The `agent_attempts` ledger in `user.db`: one row per authorization the
 * agent dispatched, written with the queued post in one transaction
 * (`claim`). `INSERT ... ON CONFLICT DO NOTHING` decides which request owns
 * an authorization, so two requests for one authorization never queue two
 * posts. The row keeps the text the post carries.
 */
import { StoreWriter, StoreReader } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { Attempt, AttemptRecord, AttemptState } from '@juno/agent-juno'
import { queueText } from '../postQueue'
import * as approvals from './approvals'

interface Row {
  readonly authorization_id: string
  readonly attempt_id: string
  readonly action_id: string
  readonly channel: string
  readonly thread_ts: string | null
  readonly text: string
  readonly state: AttemptState['_tag']
  readonly result_json: string | null
}

type Settled = Exclude<AttemptState, { _tag: 'submitted' | 'cancelled' }>

const stateOf = (row: Row): AttemptState => {
  const result = row.result_json === null ? {} : (JSON.parse(row.result_json) as Record<string, unknown>)
  switch (row.state) {
    case 'done':
      return { _tag: 'done', receipt: result['receipt'] as { channelId: string; ts: string } }
    case 'failed':
      return { _tag: 'failed', reason: String(result['reason'] ?? '') }
    case 'submitted':
    case 'unknown':
    case 'cancelled':
      return { _tag: row.state }
  }
}

const recordOf = (row: Row): AttemptRecord =>
  ({
    authorizationId: row.authorization_id,
    attemptId: row.attempt_id,
    actionId: row.action_id,
    channelId: row.channel,
    ...(row.thread_ts === null ? {} : { threadTs: row.thread_ts }),
    text: row.text,
    state: stateOf(row),
  }) as AttemptRecord

const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString())

/** The row of this authorization, or of this attempt id. */
const find = (authorizationId: string, attemptId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const [row] = yield* sql<Row>`SELECT * FROM agent_attempts WHERE authorization_id = ${authorizationId} OR attempt_id = ${attemptId}
      ORDER BY authorization_id = ${authorizationId} DESC LIMIT 1`
    return row === undefined ? undefined : recordOf(row)
  })

/** Inserts the row unless the authorization has one; returns the existing row in that case. */
const insert = (values: { authorizationId: string; attemptId: string; actionId: string; channelId: string; threadTs: string | null; text: string; state: 'submitted' | 'cancelled' }) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const at = yield* now
    const inserted = yield* sql<{ authorization_id: string }>`
      INSERT INTO agent_attempts (authorization_id, attempt_id, action_id, channel, thread_ts, text, state, created_at)
      VALUES (${values.authorizationId}, ${values.attemptId}, ${values.actionId}, ${values.channelId}, ${values.threadTs}, ${values.text}, ${values.state}, ${at})
      ON CONFLICT DO NOTHING
      RETURNING authorization_id`
    if (inserted.length > 0) return undefined
    return yield* find(values.authorizationId, values.attemptId)
  })

/**
 * The send's record if its authorization has one. Otherwise takes the
 * owner's click on the action and `digest` (`approvals.take`), records the
 * attempt as `submitted` and queues the post the composer's way. Run it in
 * one transaction, so a click is never taken without its post.
 */
export const claim = (attempt: Attempt, digest: string) =>
  Effect.gen(function* () {
    const prior = yield* find(attempt.authorizationId, attempt.attemptId)
    if (prior !== undefined) return prior
    yield* approvals.take(attempt.actionId, digest, attempt.authorizationId)
    const createdAt = yield* Clock.currentTimeMillis
    const text = yield* queueText({ clientMsgId: attempt.actionId, channel: attempt.channelId, threadTs: attempt.threadTs, text: attempt.text, createdAt })
    return yield* insert({
      authorizationId: attempt.authorizationId,
      attemptId: attempt.attemptId,
      actionId: attempt.actionId,
      channelId: attempt.channelId,
      threadTs: attempt.threadTs ?? null,
      text,
      state: 'submitted',
    })
  })

export const cancel = (authorizationId: string, attemptId: string) =>
  insert({ authorizationId, attemptId, actionId: '', channelId: '', threadTs: null, text: '', state: 'cancelled' })

/**
 * Settles a `submitted` row, or turns an `unknown` or `failed` one `done`: the
 * outbox row went on to post it (a lookup found it, or the owner retried it
 * from the topic). A done result is never replaced.
 */
export const settle = (authorizationId: string, state: Settled) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const at = yield* now
    const result = state._tag === 'done' ? { receipt: state.receipt } : state._tag === 'failed' ? { reason: state.reason } : null
    const from = state._tag === 'done' ? ['submitted', 'unknown', 'failed'] : ['submitted']
    yield* sql`UPDATE agent_attempts SET state = ${state._tag}, result_json = ${result === null ? null : JSON.stringify(result)}, settled_at = ${at}
      WHERE authorization_id = ${authorizationId} AND state IN ${sql.in(from)}`
  })

export const byAttempt = (attemptId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [row] = yield* sql<Row>`SELECT * FROM agent_attempts WHERE attempt_id = ${attemptId}`
    return row === undefined ? undefined : recordOf(row)
  })

/** How far back the outbox states follow sends, and how many at most. */
const RECENT_MILLIS = 30 * 24 * 60 * 60_000
const RECENT_LIMIT = 200

/** The sends of the last 30 days, newest first, at most 200. A cancelled authorization sent nothing. */
export const recent = Effect.gen(function* () {
  const sql = yield* StoreReader
  const since = new Date((yield* Clock.currentTimeMillis) - RECENT_MILLIS).toISOString()
  const rows = yield* sql<Row>`SELECT * FROM agent_attempts WHERE state != 'cancelled' AND created_at >= ${since} ORDER BY created_at DESC LIMIT ${RECENT_LIMIT}`
  return rows.map(recordOf)
})
