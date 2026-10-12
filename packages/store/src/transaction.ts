import { Effect, Schedule } from 'effect'
import { isSqlError, type SqlError } from 'effect/sql/SqlError'
import { StoreWriter } from './clients'
import { Invalidation } from './invalidation'

/**
 * Rows per write transaction during backfill. A transaction holds the write
 * lock for its whole duration, so bulk writes are split into chunks of this
 * size and a live query or a command never waits more than a few
 * milliseconds. Use `inBatches` to apply it.
 */
export const BATCH_ROWS = 200

/** How often a transaction that hits the busy timeout is retried before failing. */
const BUSY_RETRIES = 5

const isLockTimeout = (e: unknown) => isSqlError(e) && e.reason._tag === 'LockTimeoutError'

/**
 * Runs `effect` inside one writer transaction (`BEGIN IMMEDIATE`). Keys
 * invalidated inside fire once, after the commit; on rollback nothing fires.
 * A lock timeout retries the whole transaction a few times with backoff.
 * Nested calls become savepoints and share the outer batch.
 */
export const transaction = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SqlError, R | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const invalidation = yield* Invalidation
    return yield* invalidation.withBatch(sql.withTransaction(effect)).pipe(
      Effect.retry({
        while: isLockTimeout,
        times: BUSY_RETRIES,
        schedule: Schedule.exponential('10 millis').pipe(Schedule.jittered),
      }),
    )
  })

/**
 * Splits `rows` into chunks of `size` (default `BATCH_ROWS`) and runs `write`
 * for each chunk in its own transaction, in order.
 */
export const inBatches = <Row, E, R>(
  rows: ReadonlyArray<Row>,
  write: (chunk: ReadonlyArray<Row>) => Effect.Effect<unknown, E, R>,
  size: number = BATCH_ROWS,
): Effect.Effect<void, E | SqlError, R | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    for (let i = 0; i < rows.length; i += size) {
      yield* transaction(write(rows.slice(i, i + size)))
    }
  })
