/**
 * Grammar answers by exact text (SPEC section 8). A typing pause starts the
 * request, so the second after sending usually has the answer already; a
 * send with no pause starts it then. Each text is asked once: the answer, or
 * its timeout, is stored in `ai_cache` under the text's hash, and a request
 * still running is shared. A newer pause or an edit in the same composer
 * stops the request its last pause started, unless that text was sent. Every
 * request counts against a persisted daily cap, including failed and stopped
 * ones, and the spend ledger treats it as background work (`ai.ts`).
 */
import { AiProvider, cacheKeyOf, grammarCheck, type GrammarEdit } from '@juno/ai'
import { StoreReader, StoreWriter, type SqlError } from '@juno/store'
import { Clock, Deferred, Effect, Fiber } from 'effect'

/** A persisted daily call cap includes failed requests and survives restarts. */
const DAILY_CALLS = 500

type Edits = ReadonlyArray<GrammarEdit>

interface Flight {
  readonly done: Deferred.Deferred<Edits>
  readonly workspace: unknown
  fiber: Fiber.Fiber<void> | undefined
  /** Sent: an edit in its composer no longer stops it. */
  sent: boolean
}

/** Whether grammar runs on this text at all: at most 1,000 characters, with prose left after masking. */
export const grammarApplies = (draft: string): boolean => [...draft].length <= 1000 && grammarCheck.render({ draft }).trim() !== ''

const hashOf = (draft: string): string => cacheKeyOf(grammarCheck, { draft }).inputHash

/** The finished answer stored for this text. A row whose answer is `''` is a request under way or stopped. */
const stored = (hash: string) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ output_json: string }>`SELECT output_json FROM ai_cache WHERE task = 'grammarCheck' AND key = ${hash} AND output_json != ''`
  return rows[0] === undefined ? undefined : (JSON.parse(rows[0].output_json) as { readonly edits: Edits }).edits
})

/** Asks the model about one text unless its answer is stored or the daily cap is spent. */
const request = (draft: string, hash: string): Effect.Effect<Edits, SqlError, AiProvider | StoreReader | StoreWriter> => Effect.gen(function* () {
  const known = yield* stored(hash)
  if (known !== undefined) return known
  const sql = yield* StoreWriter
  const now = yield* Clock.currentTimeMillis
  const dayStart = String(Math.floor(now / 86_400_000) * 86_400_000)
  // A row left unanswered by a request that died with the engine is taken over.
  const claimed = yield* sql<{ key: string }>`INSERT INTO ai_cache (task, key, input_hash, output_json, model, created_at)
    SELECT 'grammarCheck', ${hash}, ${hash}, '', '', ${String(now)}
    WHERE (SELECT COUNT(*) FROM ai_cache WHERE task = 'grammarCheck' AND CAST(created_at AS INTEGER) >= CAST(${dayStart} AS INTEGER)) < ${DAILY_CALLS}
    ON CONFLICT (task, key) DO UPDATE SET created_at = excluded.created_at WHERE ai_cache.output_json = '' RETURNING key`
  if (claimed.length === 0) return []
  // A stopped request keeps its row for the cap, under a key no text has.
  const release = sql`UPDATE ai_cache SET key = ${`${hash}:stopped:${now}`} WHERE task = 'grammarCheck' AND key = ${hash} AND output_json = ''`.pipe(Effect.ignore)
  const decision = yield* (yield* AiProvider).decide(grammarCheck, { draft }).pipe(Effect.onInterrupt(() => release))
  const output = decision._tag === 'Decided' ? decision.value : { edits: [] }
  yield* sql`UPDATE ai_cache SET output_json = ${JSON.stringify(output)}, model = ${decision.meta.model}, cost_usd = ${decision.meta.costUsd ?? null}
    WHERE task = 'grammarCheck' AND key = ${hash}`
  return output.edits
})

export interface GrammarChecks {
  /** A typing pause in `slot` (one composer's place): starts the request for `draft`, stopping the slot's previous one. */
  readonly prefetch: (slot: string, draft: string, workspace: unknown) => Effect.Effect<void, never, AiProvider | StoreReader | StoreWriter>
  /** The slot's text changed after a pause: stops its request unless that text was sent. */
  readonly stop: (slot: string) => Effect.Effect<void>
  /** `draft` was sent: its request runs to the end even if its composer changes. */
  readonly sent: (draft: string) => void
  /** The edits for a sent text, waiting at most `waitMillis` for a request under way. Starts one if none is. */
  readonly answer: (draft: string, workspace: unknown, waitMillis: number) => Effect.Effect<Edits, never, AiProvider | StoreReader | StoreWriter>
}

export function grammarChecks(): GrammarChecks {
  const flights = new Map<string, Flight>()
  const slots = new Map<string, string>()

  const start = (draft: string, workspace: unknown) => Effect.gen(function* () {
    const hash = hashOf(draft)
    const running = flights.get(hash)
    if (running !== undefined && running.workspace === workspace) return running
    const flight: Flight = { done: Deferred.makeUnsafe<Edits>(), workspace, fiber: undefined, sent: false }
    flights.set(hash, flight)
    flight.fiber = yield* request(draft, hash).pipe(
      Effect.catch((error) => Effect.logWarning('grammar: a request failed', error).pipe(Effect.as<Edits>([]))),
      Effect.onExit((exit) => Effect.sync(() => {
        if (flights.get(hash) === flight) flights.delete(hash)
        Deferred.doneUnsafe(flight.done, exit._tag === 'Success' ? Effect.succeed(exit.value) : Effect.succeed([]))
      })),
      Effect.asVoid,
      Effect.forkDetach,
    )
    return flight
  })

  const stopHash = (hash: string | undefined) => Effect.gen(function* () {
    const flight = hash === undefined ? undefined : flights.get(hash)
    if (flight === undefined || flight.sent || flight.fiber === undefined) return
    yield* Fiber.interrupt(flight.fiber)
  })

  return {
    prefetch: (slot, draft, workspace) => Effect.gen(function* () {
      if (!grammarApplies(draft)) return yield* stopHash(slots.get(slot)).pipe(Effect.andThen(Effect.sync(() => slots.delete(slot))))
      const hash = hashOf(draft)
      const previous = slots.get(slot)
      if (previous !== hash) yield* stopHash(previous)
      slots.set(slot, hash)
      yield* start(draft, workspace)
    }),
    stop: (slot) => Effect.gen(function* () {
      const hash = slots.get(slot)
      slots.delete(slot)
      yield* stopHash(hash)
    }),
    sent: (draft) => {
      const flight = flights.get(hashOf(draft))
      if (flight !== undefined) flight.sent = true
    },
    answer: (draft, workspace, waitMillis) => Effect.gen(function* () {
      if (!grammarApplies(draft) || waitMillis <= 0) return []
      const flight = yield* start(draft, workspace)
      flight.sent = true
      const edits = yield* Deferred.await(flight.done).pipe(Effect.timeoutOption(waitMillis))
      return edits._tag === 'Some' ? edits.value : []
    }),
  }
}
