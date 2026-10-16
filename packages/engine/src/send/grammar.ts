import { AiProvider, grammarCheck } from '@juno/ai'
import { StoreWriter } from '@juno/store'
import { Clock, Effect } from 'effect'

/** A persisted daily call cap includes failed requests and survives restarts. */
const DAILY_CALLS = 500

export const askGrammar = (draft: string, clientMsgId: string) => Effect.gen(function* () {
  if ([...draft].length > 1000 || grammarCheck.render({ draft }).trim() === '') return []
  const sql = yield* StoreWriter
  const now = yield* Clock.currentTimeMillis
  const dayStart = String(Math.floor(now / 86_400_000) * 86_400_000)
  const claimed = yield* sql<{ key: string }>`INSERT INTO ai_cache (task, key, input_hash, output_json, model, created_at)
    SELECT 'grammarCheck', ${clientMsgId}, ${clientMsgId}, '{"edits":[]}', '', ${String(now)}
    WHERE (SELECT COUNT(*) FROM ai_cache WHERE task = 'grammarCheck' AND CAST(created_at AS INTEGER) >= CAST(${dayStart} AS INTEGER)) < ${DAILY_CALLS}
    ON CONFLICT (task, key) DO NOTHING RETURNING key`
  if (claimed.length === 0) return []
  const decision = yield* (yield* AiProvider).decide(grammarCheck, { draft })
  const output = decision._tag === 'Decided' ? decision.value : { edits: [] }
  yield* sql`UPDATE ai_cache SET output_json = ${JSON.stringify(output)}, model = ${decision.meta.model}, cost_usd = ${decision.meta.costUsd ?? null}
    WHERE task = 'grammarCheck' AND key = ${clientMsgId}`
  return output.edits
})
