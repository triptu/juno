/**
 * Helpers for live query handlers (architecture 2.6, performance 2.2 and 6).
 *
 * - `liveValue` turns a stream of values into `LiveValue` messages with meta.
 * - `liveList` runs a windowed query on every invalidation and emits
 *   `ListDelta`s: the whole window first (`reset: true`), then only rows whose
 *   `rev` changed plus the ids that left the window. The last `{ order,
 *   revById }` per subscription lives here, so handlers only write the query.
 *
 * Invalidations are debounced leading-edge with a 30 ms trailing run, so a
 * burst of socket events costs two query runs, and the first one is not
 * delayed.
 */
import { Clock, Effect, Queue, Scope, Stream } from 'effect'
import { LIVE_DELTA_MAX_BYTES, LIVE_SNAPSHOT_MAX_BYTES, type ListDelta, type LiveMeta, type LiveValue } from '@juno/contract'

const TRAILING_DEBOUNCE_MS = 30

interface Timed<A> {
  readonly value: A
  readonly queryMs: number
}

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Timed<A>, E, R> =>
  Effect.gen(function* () {
    const start = performance.now()
    const value = yield* effect
    return { value, queryMs: performance.now() - start }
  })

/** Stamps every value with `LiveMeta`. `queryMs` is the time `query` took when given. */
export function liveValue<A, E, R>(options: {
  /** The current value, run once at subscribe time. */
  readonly query: Effect.Effect<A, E, R>
  /** Re-run `query` whenever this emits. */
  readonly invalidations: Stream.Stream<unknown, E, R>
}): Stream.Stream<LiveValue<A>, E, R> {
  let seq = 0
  return runs(options).pipe(
    Stream.mapEffect(({ value, queryMs }) =>
      Clock.currentTimeMillis.pipe(Effect.map((at) => ({ value, meta: { seq: ++seq, queryMs, encodeMs: 0, at } }))),
    ),
  )
}

export interface ListRun<Row> {
  readonly rows: ReadonlyArray<Row>
  readonly total?: number
}

interface RowLike {
  readonly id: string
  readonly rev: number
}

/**
 * Runs `query` first, then on every invalidation, and emits deltas. `encode`
 * is the row codec of the route; it is used to measure `encodeMs` and to
 * enforce the size budgets on the rows that actually travel.
 */
export function liveList<Row extends RowLike, E, R>(options: {
  readonly query: Effect.Effect<ListRun<Row>, E, R>
  readonly invalidations: Stream.Stream<unknown, E, R>
  readonly encodeRow: (row: Row) => unknown
}): Stream.Stream<ListDelta<Row>, E, R> {
  let seq = 0
  let order: ReadonlyArray<string> = []
  let revById = new Map<string, number>()
  return runs(options).pipe(
    Stream.mapEffect(({ value: run, queryMs }) =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        const reset = seq === 0
        const nextOrder = run.rows.map((row) => row.id)
        const nextRevById = new Map<string, number>()
        const upsert: Array<Row> = []
        for (const row of run.rows) {
          nextRevById.set(row.id, row.rev)
          if (reset || revById.get(row.id) !== row.rev) upsert.push(row)
        }
        const remove: Array<string> = []
        for (const id of revById.keys()) if (!nextRevById.has(id)) remove.push(id)
        const encodeStart = performance.now()
        const bytes = upsert.reduce((n, row) => n + JSON.stringify(options.encodeRow(row)).length, 0)
        const encodeMs = performance.now() - encodeStart
        const budget = reset ? LIVE_SNAPSHOT_MAX_BYTES : LIVE_DELTA_MAX_BYTES
        if (bytes > budget) yield* Effect.logWarning(`live list message of ${bytes} bytes exceeds the ${budget} byte budget`)
        order = sameOrder(order, nextOrder) ? order : nextOrder
        revById = nextRevById
        const meta: LiveMeta = { seq: ++seq, queryMs, encodeMs, at, ...(run.total === undefined ? {} : { total: run.total }) }
        return { reset, order, upsert, remove, meta }
      }),
    ),
  )
}

function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * One run now, then one per invalidation burst: the first invalidation runs
 * at once, anything that arrives in the next 30 ms collapses into one more.
 */
function runs<A, E, R>(options: {
  readonly query: Effect.Effect<A, E, R>
  readonly invalidations: Stream.Stream<unknown, E, R>
}): Stream.Stream<Timed<A>, E, R> {
  return Stream.callback<Timed<A>, E, R>(
    Effect.fnUntraced(function* (out) {
      const emit = timed(options.query).pipe(Effect.flatMap((value) => Queue.offer(out, value)))
      yield* emit
      const scope = yield* Effect.scope
      const invalidations = yield* Stream.toQueue(options.invalidations, { capacity: 'unbounded' }).pipe(Scope.provide(scope))
      yield* Effect.gen(function* () {
        while (true) {
          yield* Queue.take(invalidations)
          yield* emit
          yield* Effect.sleep(TRAILING_DEBOUNCE_MS)
          const more = yield* Queue.clear(invalidations)
          if (more.length > 0) yield* emit
        }
      }).pipe(Effect.catchCause((cause) => Queue.failCause(out, cause)), Effect.forkIn(scope))
    }),
  )
}
