/**
 * Reactions as outbox rows (architecture 5.7, specs/outbox.qnt): the
 * `react` row per message and emoji that `queueReaction` writes, and the
 * worker's marks on it. A row keeps the user's intent (`want`) and Slack's
 * state when last known (`base`), so an add and a remove cancel unsent. A
 * reaction Slack refused stays as `failed` until the user retries or
 * dismisses it; one that has waited long is marked `stalled`.
 */
import { StoreWriter, type Invalidation, type MessageRow, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { actionsOn, deleteActions, insertAction, resolveTarget, targetFields, touch, writePayload, type ActionRefusal, type MessageRef, type PendingAction } from './actions'

/** Whether the action waits for the user instead of the worker. */
export const isFailed = (action: PendingAction): boolean => action.payload.failed !== undefined

export interface ReactInput {
  readonly ref: MessageRef
  readonly name: string
  /** Add the user's reaction, or take it away. */
  readonly on: boolean
  readonly now: number
}

/** Whether the store says the user has reacted with `name`. */
const storedReaction = (row: MessageRow, name: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ me: 0 | 1 }>`SELECT me FROM reactions WHERE channel = ${row.channel} AND ts = ${row.ts} AND name = ${name}`
    return rows[0]?.me === 1
  })

/**
 * A reaction toggled: the message's `react` row for `name` takes the
 * intent. A row whose intent is back to what Slack has is left for the
 * worker to drop unsent, so a toggle while a call is out stays ordered.
 */
export const queueReaction = (input: ReactInput): Effect.Effect<ActionRefusal | undefined, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const target = yield* resolveTarget(input.ref)
    if (target === undefined || (target.kind === 'stored' && target.row.deleted === 1)) return 'missing'
    if (target.kind === 'pending' && target.post.state === 'failed') return 'not-sent'
    const actions = yield* actionsOn(target)
    if (actions.some((action) => action.kind === 'delete')) return 'missing'
    const pending = actions.find((action) => action.kind === 'react' && action.payload.name === input.name)
    const base = target.kind === 'stored' ? yield* storedReaction(target.row, input.name) : false
    if (pending !== undefined && isFailed(pending)) {
      // A refused change: asking for what Slack has dismisses it; asking again (Retry) sends it again.
      if (base === input.on) yield* deleteActions([pending])
      else {
        const { failed: _failed, stalled: _stalled, ...rest } = pending.payload
        yield* writePayload(pending, { ...rest, want: input.on, base }, input.now)
      }
      return undefined
    }
    if (pending !== undefined) {
      if (pending.payload.want !== input.on) {
        const { stalled: _stalled, ...payload } = pending.payload
        yield* writePayload(pending, { ...payload, want: input.on }, input.now)
      }
      return undefined
    }
    if (base === input.on) return undefined
    const { channel, dependsOn, ...fields } = targetFields(target)
    yield* insertAction('react', channel, dependsOn, { ...fields, name: input.name, want: input.on, base }, input.now)
    return undefined
  })

/** A reaction that has waited too long without going out: the view says it is not sent yet. Leaves its timing alone. */
export const markStalled = (action: PendingAction): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET payload_json = ${JSON.stringify({ ...action.payload, stalled: true })} WHERE id = ${action.id} AND created_at = ${String(action.createdAt)} AND payload_json = ${JSON.stringify(action.payload)}`
    yield* touch(action.payload.topics)
  })
