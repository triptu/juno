import { Effect } from 'effect'
import { StoreWriter } from '@juno/store'
import { dropAction, readAction, touch, writePayload, type PendingAction } from './actions'

/** A failed action keeps its intent for Retry but no longer holds its channel. Ignore answers for a replaced intent. */
export const failAction = (action: PendingAction, code: string) => Effect.gen(function* () {
  const current = yield* readAction(action.id)
  if (current === undefined || JSON.stringify(current.payload) !== JSON.stringify(action.payload)) return
  const sql = yield* StoreWriter
  const { stalled: _stalled, ...payload } = current.payload
  yield* sql`UPDATE outbox SET payload_json = ${JSON.stringify({ ...payload, failed: code })}, last_error = ${code} WHERE id = ${action.id}`
  yield* touch(payload.topics)
})

/** An explicit user choice ends a failed action or gives its intent a fresh retry budget. */
export const resolveFailedAction = (id: number, retry: boolean, now: number) => Effect.gen(function* () {
  const action = yield* readAction(id)
  if (action?.payload.failed === undefined) return
  if (!retry) return yield* dropAction(action)
  const { failed: _failed, stalled: _stalled, ...payload } = action.payload
  yield* writePayload(action, payload, now)
})
