/**
 * The user the topic index is computed for, as the sync stored them, so a
 * command outside the sync re-indexes with the same mention rules.
 */
import type { Me } from '@juno/domain'
import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { getSyncState } from './write/state'

/** `sync_state.me`: the user and their user groups. */
export const ME_KEY = 'me'

/**
 * The user as the last boot saw them, with their user groups. Before any
 * boot, the team's self id without groups; `undefined` when the store has
 * neither.
 */
export const storedMe: Effect.Effect<Me | undefined, SqlError, StoreWriter> = Effect.gen(function* () {
  const me = yield* getSyncState<Me>(ME_KEY)
  if (me !== undefined) return me
  const sql = yield* StoreWriter
  const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  const self = team[0]?.self_user_id
  return self === null || self === undefined ? undefined : { userId: self as Me['userId'] }
})
