import { syncState, type SqlError, type StoreReader } from '@juno/store'
import { BOOT_KEY, HOME_READY_KEY } from '@juno/sync'
import { Effect } from 'effect'

/**
 * Where Home stands in the first sync. `ready`: the DMs, mentions and
 * unread followed threads have their history (owner, 10-18), or a boot has
 * finished. `firstSync`: no boot has finished yet, so history is still
 * landing.
 */
export const homeStage: Effect.Effect<{ readonly ready: boolean; readonly firstSync: boolean }, SqlError, StoreReader> = Effect.gen(function* () {
  const booted = (yield* syncState.get(BOOT_KEY)) !== undefined
  return { ready: booted || (yield* syncState.get(HOME_READY_KEY)) !== undefined, firstSync: !booted }
})
