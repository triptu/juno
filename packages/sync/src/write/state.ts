import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'


export const getSyncState = <A>(key: string): Effect.Effect<A | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM sync_state WHERE key = ${key}`
    const row = rows[0]
    return row === undefined ? undefined : (JSON.parse(row.value_json) as A)
  })

export const setSyncState = (key: string, value: unknown): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO sync_state (key, value_json) VALUES (${key}, ${JSON.stringify(value)})
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`
  })
