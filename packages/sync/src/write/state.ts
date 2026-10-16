import { StoreWriter, type Invalidation, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'
import { invalidate } from './shared'


export const getSyncState = <A>(key: string): Effect.Effect<A | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = ${key}`
    const row = rows[0]
    return row === undefined ? undefined : (JSON.parse(row.value_json) as A)
  })

/** Fires `sync_state`: the sidebar and All topics read the boot markers (`windowCovered`), Home's Automated pass waits for them. */
export const setSyncState = (key: string, value: unknown): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO sync_state (key, value_json) VALUES (${key}, ${JSON.stringify(value)})
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
    yield* invalidate(syncKeys.syncState)
  })
