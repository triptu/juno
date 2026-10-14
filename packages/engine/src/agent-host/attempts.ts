/**
 * The `agent_attempts` ledger in `user.db`: one row per authorization the
 * agent dispatched, written before the Slack call. `INSERT ... ON CONFLICT
 * DO NOTHING` decides which request owns an authorization, so two requests
 * for one authorization never both call Slack.
 */
import { StoreWriter, StoreReader } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { Attempt, AttemptRecord, AttemptState } from '@juno/agent-juno'

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
    const [row] = yield* sql<Row>`SELECT * FROM agent_attempts WHERE authorization_id = ${values.authorizationId} OR attempt_id = ${values.attemptId}
      ORDER BY authorization_id = ${values.authorizationId} DESC LIMIT 1`
    return row === undefined ? undefined : recordOf(row)
  })

export const claim = (attempt: Attempt) =>
  insert({
    authorizationId: attempt.authorizationId,
    attemptId: attempt.attemptId,
    actionId: attempt.actionId,
    channelId: attempt.channelId,
    threadTs: attempt.threadTs ?? null,
    text: attempt.text,
    state: 'submitted',
  })

export const cancel = (authorizationId: string, attemptId: string) =>
  insert({ authorizationId, attemptId, actionId: '', channelId: '', threadTs: null, text: '', state: 'cancelled' })

/** Settles a `submitted` row, or turns an `unknown` one `done`. A settled result is never replaced otherwise. */
export const settle = (authorizationId: string, state: Settled) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const at = yield* now
    const result = state._tag === 'done' ? { receipt: state.receipt } : state._tag === 'failed' ? { reason: state.reason } : null
    const from = state._tag === 'done' ? ['submitted', 'unknown'] : ['submitted']
    yield* sql`UPDATE agent_attempts SET state = ${state._tag}, result_json = ${result === null ? null : JSON.stringify(result)}, settled_at = ${at}
      WHERE authorization_id = ${authorizationId} AND state IN ${sql.in(from)}`
  })

export const byAttempt = (attemptId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const [row] = yield* sql<Row>`SELECT * FROM agent_attempts WHERE attempt_id = ${attemptId}`
    return row === undefined ? undefined : recordOf(row)
  })
