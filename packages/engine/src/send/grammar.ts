import { AiProvider, cacheKeyOf, grammarCheck, validateOutput } from '@juno/ai'
import { StoreReader, StoreWriter } from '@juno/store'
import { Clock, Effect } from 'effect'

const keyOf = (draft: string) => cacheKeyOf(grammarCheck, { draft }).inputHash

/** Timeouts are cached as empty findings too: another Enter never re-asks. */
export const grammarFor = (draft: string) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const key = keyOf(draft)
  const rows = yield* sql<{ output_json: string }>`SELECT output_json FROM ai_cache WHERE task = 'grammarCheck' AND key = ${key} AND input_hash = ${key}`
  if (rows[0] === undefined) return []
  const checked = validateOutput(grammarCheck, { draft }, JSON.parse(rows[0].output_json))
  return checked.ok ? checked.value.edits : []
})

/** Reserve the hash before starting, so concurrent pauses share one call. */
export const askGrammar = (draft: string) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const key = keyOf(draft)
  const now = String(yield* Clock.currentTimeMillis)
  const claimed = yield* sql<{ key: string }>`INSERT INTO ai_cache (task, key, input_hash, output_json, model, created_at)
    VALUES ('grammarCheck', ${key}, ${key}, '{"edits":[]}', '', ${now}) ON CONFLICT (task, key) DO NOTHING RETURNING key`
  if (claimed.length === 0) return
  const decision = yield* (yield* AiProvider).decide(grammarCheck, { draft })
  const output = decision._tag === 'Decided' ? decision.value : { edits: [] }
  yield* sql`UPDATE ai_cache SET output_json = ${JSON.stringify(output)}, model = ${decision.meta.model}, cost_usd = ${decision.meta.costUsd ?? null}
    WHERE task = 'grammarCheck' AND key = ${key}`
})
