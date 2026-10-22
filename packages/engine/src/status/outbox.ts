import { Effect, Schema } from 'effect'
import { StoreReader } from '@juno/store'
import { OutboxCount } from '@juno/contract'

/** Read only aggregates; never select content or server error strings. */
export const outboxCounts = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql`
    SELECT 'post' AS kind, state, count(*) AS count FROM pending_messages GROUP BY state
    UNION ALL
    SELECT kind, CASE
      WHEN json_extract(payload_json, '$.failed') IS NOT NULL THEN 'failed'
      WHEN depends_on IS NOT NULL THEN 'waiting'
      WHEN attempts > 0 THEN 'retrying' ELSE 'queued' END AS state, count(*) AS count
    FROM outbox WHERE kind IN ('mark', 'edit', 'delete', 'react', 'broadcast') GROUP BY kind, state`
  return yield* Schema.decodeUnknownEffect(Schema.Array(OutboxCount))(rows)
})
