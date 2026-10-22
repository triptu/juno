/**
 * Keyed invalidation for live queries.
 *
 * This is the only module in the codebase that imports
 * `effect/reactivity/Reactivity` (an unstable module). It adds what the store
 * needs on top of it: keys that are table names with optional row ids,
 * batching that fires only after a transaction commits, a wildcard key so a
 * cache reset re-runs every live query, and `liveQuery`, a stream that re-runs
 * a read when its keys are invalidated with a leading-edge debounce and emits
 * each run's result as a value, so one failed run never ends a subscription.
 */
import { Cause, Context, Duration, Effect, Exit, Layer, Option, Queue, Result, Stream } from 'effect'
import * as Reactivity from 'effect/reactivity/Reactivity'

/**
 * Invalidation keys. A key is a table name (`'messages'`) or a table name with
 * row ids (`{ messages: ['C1'] }`). A live query registered on a table name
 * re-runs when any row of that table is invalidated; one registered on
 * `{ messages: ['C1'] }` re-runs for `['messages']` and for
 * `{ messages: ['C1'] }` but not for `{ messages: ['C2'] }`. In the record
 * form an empty id list (`{ users: [] }`) registers the whole table, so one
 * subscription can mix row keys and table keys.
 */
export type InvalidationKeys = ReadonlyArray<string> | Readonly<Record<string, ReadonlyArray<string>>>

/** Matches every live query, whatever keys it registered. */
export const ALL_KEYS = '*'

export interface LiveQueryOptions {
  /**
   * Window after a run during which further invalidations collapse into one
   * trailing re-run. The first invalidation after an idle period runs at once.
   * Default 30 ms.
   */
  readonly debounce?: Duration.Input | undefined
}

export const DEFAULT_LIVE_QUERY_DEBOUNCE: Duration.Input = '30 millis'

/** Writes made by a renderer command, rather than sync. */
export class CommandWrite extends Context.Reference<boolean>('juno/store/CommandWrite', { defaultValue: () => false }) {}

/** The cause of this query run, including writes received while it was reading. */
export class QueryCause extends Context.Reference<{ own: boolean }>('juno/store/QueryCause', { defaultValue: () => ({ own: false }) }) {}

/** Collects keys invalidated inside `withBatch` until the batch succeeds. */
const PendingKeys = Context.Reference<{ readonly keys: Set<string>; own: boolean } | undefined>('juno/store/Invalidation/PendingKeys', {
  defaultValue: () => undefined,
})

/**
 * Keys are flattened to strings before `Reactivity` sees them, so the matching
 * rule is the wrapper's, not the library's:
 *
 * - a subscription on `['t']` or `{ t: [] }` listens on `t`; one on
 *   `{ t: [id] }` listens on `t:*` and `t:id`;
 * - an invalidation of `['t']` fires `t` and `t:*`; one of `{ t: [id] }` fires
 *   `t` and `t:id`.
 *
 * So a table-level subscription fires for any row, and a row-level one fires
 * for its own rows or the whole table, never for another row.
 */
const entries = (keys: InvalidationKeys) =>
  Array.isArray(keys)
    ? null
    : Object.entries(keys as Readonly<Record<string, ReadonlyArray<string>>>)

const subscriptionKeys = (keys: InvalidationKeys): Array<string> => {
  const out: Array<string> = [ALL_KEYS]
  const record = entries(keys)
  if (record === null) {
    out.push(...(keys as ReadonlyArray<string>))
    return out
  }
  for (const [table, ids] of record) {
    // No ids: the whole table, as in the array form.
    if (ids.length === 0) {
      out.push(table)
      continue
    }
    out.push(`${table}:*`)
    for (const id of ids) out.push(`${table}:${id}`)
  }
  return out
}

const invalidationKeys = (keys: InvalidationKeys): Array<string> => {
  const out: Array<string> = []
  const record = entries(keys)
  if (record === null) {
    for (const table of keys as ReadonlyArray<string>) out.push(table, `${table}:*`)
    return out
  }
  for (const [table, ids] of record) {
    out.push(table)
    for (const id of ids) out.push(`${table}:${id}`)
  }
  return out
}

export class Invalidation extends Context.Service<
  Invalidation,
  {
    /** Marks keys as changed. Inside `withBatch` the keys are held until the batch succeeds. */
    invalidate(keys: InvalidationKeys): Effect.Effect<void>
    /** Re-runs every live query. Used after a cache reset. */
    invalidateAll: Effect.Effect<void>
    /** Runs `effect`; keys invalidated inside fire once, after it succeeds. Nested batches join the outer one. */
    withBatch<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
    /** Registers a synchronous handler for keys. Returns the function that removes it. */
    subscribeUnsafe(keys: InvalidationKeys, handler: () => void): () => void
    /**
     * A stream that emits the result of `query` now and again whenever `keys`
     * are invalidated. A failed run is emitted as `Result.fail(e)` and the
     * subscription stays alive; only a defect fails the stream.
     */
    liveQuery<A, E, R>(
      keys: InvalidationKeys,
      query: Effect.Effect<A, E, R>,
      options?: LiveQueryOptions,
    ): Stream.Stream<Result.Result<A, E>, never, R>
    /** Provides the underlying `Reactivity` service to an effect. Only `clients.ts` needs this, to build SQL clients. */
    provideReactivity<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Reactivity.Reactivity>>
  }
>()('juno/store/Invalidation') {
  static readonly layer: Layer.Layer<Invalidation> = Layer.effect(
    Invalidation,
    Effect.gen(function* () {
      const reactivity = yield* Reactivity.make

      let ownWrite = false
      const fire = (keys: ReadonlyArray<string>, own: boolean) => {
        const previous = ownWrite
        ownWrite = own
        try { if (keys.length > 0) reactivity.invalidateUnsafe(keys) }
        finally { ownWrite = previous }
      }

      const invalidate = (keys: InvalidationKeys) =>
        Effect.gen(function* () {
          const pending = yield* PendingKeys
          const flat = invalidationKeys(keys)
          if (pending === undefined) {
            fire(flat, yield* CommandWrite)
          } else {
            for (const key of flat) pending.keys.add(key)
            pending.own ||= yield* CommandWrite
          }
        })

      const invalidateAll = Effect.gen(function* () { fire([ALL_KEYS], yield* CommandWrite) })

      const withBatch = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.gen(function* () {
          const outer = yield* PendingKeys
          if (outer !== undefined) return yield* effect
          const pending = { keys: new Set<string>(), own: false }
          const result = yield* effect.pipe(Effect.provideService(PendingKeys, pending))
          fire([...pending.keys], pending.own)
          return result
        })

      const subscribeUnsafe = (keys: InvalidationKeys, handler: () => void) =>
        reactivity.registerUnsafe(subscriptionKeys(keys), handler)

      const liveQuery = <A, E, R>(
        keys: InvalidationKeys,
        query: Effect.Effect<A, E, R>,
        options?: LiveQueryOptions,
      ): Stream.Stream<Result.Result<A, E>, never, R> => {
        const debounce = Duration.fromInputUnsafe(options?.debounce ?? DEFAULT_LIVE_QUERY_DEBOUNCE)
        return Stream.callback<Result.Result<A, E>, never, R>((out) =>
          Effect.gen(function* () {
            // One slot: invalidations that arrive while one is waiting collapse into it.
            const signal = yield* Queue.make<void>({ capacity: 1, strategy: 'dropping' })
            let pendingOwn = false
            let reading: { own: boolean } | undefined
            const cancel = subscribeUnsafe(keys, () => {
              pendingOwn ||= ownWrite
              if (reading !== undefined) reading.own ||= ownWrite
              Queue.offerUnsafe(signal, undefined)
            })
            yield* Effect.addFinalizer(() => Effect.sync(cancel))

            // Emits the run's outcome. An expected error is a value and the
            // loop goes on; a defect is a bug, so it fails the stream.
            const runOnce = Effect.gen(function* () {
              const cause = { own: pendingOwn }
              pendingOwn = false
              reading = cause
              const exit = yield* Effect.exit(query.pipe(Effect.provideService(QueryCause, cause)))
              reading = undefined
              if (Exit.isSuccess(exit)) {
                yield* Queue.offer(out, Result.succeed(exit.value))
                return true
              }
              const error = Cause.findError(exit.cause)
              if (Result.isSuccess(error)) {
                yield* Queue.offer(out, Result.fail(error.success))
                return true
              }
              Queue.failCauseUnsafe(out, error.failure)
              return false
            })

            const loop = Effect.gen(function* () {
              while (true) {
                yield* Queue.take(signal)
                // Leading edge: run now. Then hold a window; anything that
                // arrives during the run or the window becomes one trailing run.
                let again = true
                while (again) {
                  if (!(yield* runOnce)) return
                  yield* Effect.sleep(debounce)
                  again = Option.isSome(yield* Queue.poll(signal))
                }
              }
            })

            Queue.offerUnsafe(signal, undefined)
            yield* Effect.forkScoped(loop)
          }),
        )
      }

      const provideReactivity = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provideService(effect, Reactivity.Reactivity, reactivity)

      return Invalidation.of({
        invalidate,
        invalidateAll,
        withBatch,
        subscribeUnsafe,
        liveQuery,
        provideReactivity,
      })
    }),
  )
}

/** Marks keys as changed through the `Invalidation` service. */
export const invalidate = (keys: InvalidationKeys): Effect.Effect<void, never, Invalidation> =>
  Invalidation.use((i) => i.invalidate(keys))

/**
 * A stream of query results that re-runs when `keys` are invalidated. The
 * first run is immediate. Every run is emitted as a `Result`: a failed run is
 * `Result.fail(e)` and the subscription stays alive, so the caller decides
 * what a failure means (architecture 2.6: the engine re-emits the last value
 * with `meta.error`). A defect fails the stream, because it is a bug.
 */
export const liveQuery = <A, E, R>(
  keys: InvalidationKeys,
  query: Effect.Effect<A, E, R>,
  options?: LiveQueryOptions,
): Stream.Stream<Result.Result<A, E>, never, R | Invalidation> =>
  Stream.unwrap(Invalidation.use((i) => Effect.succeed(i.liveQuery(keys, query, options))))
