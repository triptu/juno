/**
 * The assistant's side of Home (architecture 10, "Home items"): one call
 * to a Home task inside the daily budget, its answer kept in `ai_cache`
 * under `cacheKeyOf(task, input)`, and the messages a task reads.
 *
 * A row's `created_at` is when it was asked, so a reader can tell an answer
 * made before the topic's latest activity (`freshFor`). An answer that did
 * not come (no key, a timeout, a provider error, no valid output) stores
 * nothing; the callers keep their own memory so they do not ask again at
 * once.
 */
import { AiProvider, cacheKeyOf, type AiMessage, type Decision, type StructuredTask, type Static, type TSchema } from '@juno/ai'
import { Invalidation, keys, StoreReader, StoreWriter, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { userName, type JoinedRow, type UserRow } from '../topicRows'
import { messagesAfter, NO_READ } from './query'
import { unescapeMrkdwn } from '@juno/richtext'

/** Home's calls per workspace per day, across its tasks. */
export const HOME_DAILY_BUDGET = 300
const HOME_TASKS = ['settledScore', 'followUps', 'homeTitle', 'automatedChannel']
const DAY = 24 * 60 * 60 * 1000

/** Calls Home made today that stored an answer. */
export const usedToday = (now: number): Effect.Effect<number, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const dayStart = String(now - (now % DAY))
    const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM ai_cache WHERE task IN ${sql.in(HOME_TASKS)} AND created_at >= ${dayStart}`
    return rows[0]?.n ?? 0
  })

/** Runs a structured task and stores a decided answer. Resolves with the decision either way. */
export const decideAndStore = <I, S extends TSchema>(
  task: StructuredTask<I, S>,
  input: I,
): Effect.Effect<Decision<Static<S>>, SqlError, AiProvider | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const provider = yield* AiProvider
    const asked = String(yield* Clock.currentTimeMillis)
    const decision = yield* provider.decide(task, input)
    if (decision._tag !== 'Decided') return decision
    const key = cacheKeyOf(task, input)
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO ai_cache (task, key, input_hash, output_json, model, cost_usd, created_at)
      VALUES (${key.task}, ${key.key}, ${key.inputHash}, ${JSON.stringify(decision.value)}, ${decision.meta.model}, ${decision.meta.costUsd ?? null}, ${asked})
      ON CONFLICT (task, key) DO UPDATE SET input_hash = excluded.input_hash, output_json = excluded.output_json, model = excluded.model,
        cost_usd = excluded.cost_usd, created_at = excluded.created_at`
    yield* (yield* Invalidation).invalidate(keys.aiCache)
    return decision
  })

const isoOf = (ts: string): string => new Date(Number(ts) * 1000).toISOString()

/** The topic's latest messages as a task reads them, oldest first, with the user's own marked. */
export const recentMessages = (
  row: Pick<JoinedRow, 'kind' | 'channel' | 'root_ts'>,
  selfId: string | undefined,
  limit: number,
): Effect.Effect<ReadonlyArray<AiMessage & { readonly id: string }>, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const messages = (yield* messagesAfter(row, NO_READ, limit)).toReversed()
    const ids = new Set(messages.flatMap((m) => (m.user_id === null ? [] : [m.user_id])))
    const users = new Map<string, UserRow>()
    if (ids.size > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...ids])}`) users.set(user.id, user)
    return messages
      .filter((m) => m.text.trim() !== '')
      .map((m) => ({
        id: m.ts,
        sender: m.user_id === null ? 'Someone' : userName(m.user_id, users.get(m.user_id)),
        // Entities decoded, so a model never reads or echoes `&gt;`; mention tokens stay for the model to read.
        text: unescapeMrkdwn(m.text).slice(0, 600),
        at: isoOf(m.ts),
        ...(m.user_id !== null && m.user_id === selfId ? { fromMe: true } : {}),
      }))
  })
