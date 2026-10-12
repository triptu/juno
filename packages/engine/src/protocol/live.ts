/**
 * Serve helpers for live query handlers (architecture 2.6, performance 2.2
 * and 6).
 *
 * A handler produces a stream of query runs and passes it here; the helpers
 * only stamp `meta` and, for lists, diff rows by `rev`. Where the runs come
 * from is the handler's business: feature handlers use the store's
 * `liveQuery(keys, timed(query))`, which owns the re-run and debounce rules;
 * `status` re-runs on its own phase changes.
 *
 * - `serveLiveValue` turns runs of a value into `LiveValue` messages.
 * - `serveLiveList` turns runs of a windowed query into `ListDelta`s: the
 *   whole window first (`reset: true`), then only rows whose `rev` changed
 *   plus the ids that left the window. The last `{ order, revById }` per
 *   subscription lives here.
 *
 * Failures: a run that fails before any value was sent fails the stream, so
 * the renderer sees the route's error. A later failure re-emits the last
 * value with `meta.error` and the subscription continues.
 */
import { Clock, Effect, Result, Stream } from 'effect'
import { LIVE_DELTA_MAX_BYTES, LIVE_SNAPSHOT_MAX_BYTES, type ListDelta, type LiveMeta, type LiveValue } from '@juno/contract'

/** A successful query run: its value and how long it took. */
export interface Timed<A> {
  readonly value: A
  readonly queryMs: number
}

/** Measures `query`. Wrap the query a handler gives the store's `liveQuery` with this. */
export const timed = <A, E, R>(query: Effect.Effect<A, E, R>): Effect.Effect<Timed<A>, E, R> =>
  Effect.gen(function* () {
    const start = performance.now()
    const value = yield* query
    return { value, queryMs: performance.now() - start }
  })

/**
 * One run as the serve helpers see it: the store's `liveQuery` emits every
 * run as a `Result`, so a failed run is a value and the stream goes on.
 */
export type Run<A, E> = Result.Result<Timed<A>, E>

export interface ServeOptions {
  /** Measure `encodeMs` and the size budgets. Costs a second encode per row; dev and e2e only. */
  readonly measure?: boolean | undefined
}

/** The error as one line for `meta.error`: the message, or the tag of a tagged error without one. */
const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  if (error.message !== '') return error.message
  const tag = (error as { readonly _tag?: unknown })._tag
  return typeof tag === 'string' ? tag : error.name
}

/** Stamps every run with `LiveMeta`. `encode` is the value codec of the route, used only when measuring. */
export function serveLiveValue<A, E, SE, R>(
  runs: Stream.Stream<Run<A, E>, SE, R>,
  options?: ServeOptions & { readonly encode?: ((value: A) => unknown) | undefined },
): Stream.Stream<LiveValue<A>, E | SE, R> {
  let seq = 0
  let last: { readonly value: A } | undefined
  return runs.pipe(
    Stream.mapEffect((run) =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        if (Result.isFailure(run)) {
          if (last === undefined) return yield* Effect.fail(run.failure)
          return { value: last.value, meta: { seq: ++seq, queryMs: 0, encodeMs: 0, at, error: describe(run.failure) } }
        }
        const { value, queryMs } = run.success
        last = { value }
        const encodeMs = options?.measure && options.encode ? measureEncode(() => options.encode!(value)).encodeMs : 0
        return { value, meta: { seq: ++seq, queryMs, encodeMs, at } }
      }),
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
 * Emits the whole window on the first run, then deltas. `encodeRow` is the
 * row codec of the route; when measuring it gives `encodeMs` and checks the
 * size budgets on the rows that actually travel.
 */
export function serveLiveList<Row extends RowLike, E, SE, R>(
  runs: Stream.Stream<Run<ListRun<Row>, E>, SE, R>,
  options: ServeOptions & { readonly encodeRow: (row: Row) => unknown },
): Stream.Stream<ListDelta<Row>, E | SE, R> {
  let seq = 0
  let order: ReadonlyArray<string> = []
  let revById = new Map<string, number>()
  return runs.pipe(
    Stream.mapEffect((outcome) =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        if (Result.isFailure(outcome)) {
          if (seq === 0) return yield* Effect.fail(outcome.failure)
          const meta: LiveMeta = { seq: ++seq, queryMs: 0, encodeMs: 0, at, error: describe(outcome.failure) }
          return { reset: false, order, upsert: [], remove: [], meta }
        }
        const { value: run, queryMs } = outcome.success
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
        let encodeMs = 0
        if (options.measure) {
          const measured = measureEncode(() => upsert.map(options.encodeRow))
          encodeMs = measured.encodeMs
          const budget = reset ? LIVE_SNAPSHOT_MAX_BYTES : LIVE_DELTA_MAX_BYTES
          if (measured.bytes > budget) {
            yield* Effect.logWarning(`live list message of ${measured.bytes} bytes exceeds the ${budget} byte budget`)
          }
        }
        order = sameOrder(order, nextOrder) ? order : nextOrder
        revById = nextRevById
        const meta: LiveMeta = { seq: ++seq, queryMs, encodeMs, at, ...(run.total === undefined ? {} : { total: run.total }) }
        return { reset, order, upsert, remove, meta }
      }),
    ),
  )
}

const encoder = new TextEncoder()

function measureEncode(encode: () => unknown): { readonly encodeMs: number; readonly bytes: number } {
  const start = performance.now()
  const json = JSON.stringify(encode())
  const encodeMs = performance.now() - start
  return { encodeMs, bytes: json === undefined ? 0 : encoder.encode(json).byteLength }
}

function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
