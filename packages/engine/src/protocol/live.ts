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
 * A run that changes nothing sends nothing: a value equal to the last one,
 * or a list run with no changed row, no removed id and the same order.
 * Every re-run of an invalidated query would otherwise cross the port and
 * wake the renderer for no visible change. `seq` counts sent messages only.
 *
 * Failures: a run that fails before any value was sent fails the stream, so
 * the renderer sees the route's error. A later failure re-emits the last
 * value with `meta.error` and the subscription continues. A route with no
 * error of its own to show pipes the stream through `retryFirstRun`, which
 * starts it again with backoff instead.
 */
import { Clock, Effect, Option, Result, Schedule, Stream } from 'effect'
import { liveQuery, type InvalidationKeys } from '@juno/store'
import type { OpenWorkspace } from '../workspace'
import { LIVE_DELTA_MAX_BYTES, LIVE_SNAPSHOT_MAX_BYTES, type ChannelRef, type ListDelta, type LiveMeta, type LiveValue, type Person, type Refs, type TopicArt } from '@juno/contract'

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

/** Structural equality for the JSON-shaped values live queries carry (performance 2.2: no `Date`, `Map` or class instances). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false
    return true
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (!(key in right) || !sameValue(left[key], right[key])) return false
  return true
}

/**
 * The error as one line for `meta.error`: the message, or the tag of a
 * tagged error without one, followed by the innermost cause's message when
 * it says more ("Failed to execute statement: no such table: x").
 */
const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  const tag = (error as { readonly _tag?: unknown })._tag
  const own = error.message !== '' ? error.message : typeof tag === 'string' ? tag : error.name
  let inner: unknown = error
  let root: string | undefined
  for (let depth = 0; depth < 4 && typeof inner === 'object' && inner !== null; depth++) {
    const next: unknown = (inner as { readonly cause?: unknown }).cause ?? (inner as { readonly reason?: unknown }).reason
    if (next instanceof Error && next.message !== '' && next.message !== own) root = next.message
    inner = next
  }
  return root === undefined ? own : `${own}: ${root}`
}

/**
 * Stamps every run with `LiveMeta` and drops a run whose value equals the
 * last one sent (`equals`, structural by default). `encode` is the value
 * codec of the route, used only when measuring.
 */
export function serveLiveValue<A, E, SE, R>(
  runs: Stream.Stream<Run<A, E>, SE, R>,
  options?: ServeOptions & { readonly encode?: ((value: A) => unknown) | undefined; readonly equals?: ((a: A, b: A) => boolean) | undefined },
): Stream.Stream<LiveValue<A>, E | SE, R> {
  const equals = options?.equals ?? sameValue
  let seq = 0
  let last: { readonly value: A } | undefined
  return runs.pipe(
    Stream.mapEffect((run) =>
      Effect.gen(function* (): Generator<Effect.Effect<number, E>, Option.Option<LiveValue<A>>> {
        const at = yield* Clock.currentTimeMillis
        if (Result.isFailure(run)) {
          if (last === undefined) return yield* Effect.fail(run.failure)
          return Option.some({ value: last.value, meta: { seq: ++seq, queryMs: 0, encodeMs: 0, at, error: describe(run.failure) } })
        }
        const { value, queryMs } = run.success
        if (last !== undefined && equals(last.value, value)) return Option.none()
        last = { value }
        const encodeMs = options?.measure && options.encode ? measureEncode(() => options.encode!(value)).encodeMs : 0
        return Option.some({ value, meta: { seq: ++seq, queryMs, encodeMs, at } })
      }),
    ),
    Stream.filter(Option.isSome),
    Stream.map((message) => message.value),
  )
}

export interface ListRun<Row> {
  readonly rows: ReadonlyArray<Row>
  readonly total?: number
  readonly windowCovered?: boolean
  /**
   * Every person and channel the rows name. `serveLiveList` sends only the
   * ones the subscription has not been sent, or that changed since.
   */
  readonly refs?: {
    readonly people?: ReadonlyArray<Person>
    readonly channels?: ReadonlyArray<ChannelRef>
    readonly art?: ReadonlyArray<TopicArt>
  }
}

interface RowLike {
  readonly id: string
  readonly rev: number
}

/**
 * Emits the whole window on the first run, then deltas, and nothing for a
 * run that changed no row, no ref and kept the order. `encodeRow` is the row
 * codec of the route; when measuring it gives `encodeMs` and checks the size
 * budgets on the rows that actually travel (refs are counted on their own).
 *
 * Refs: the subscription remembers every person and channel it has sent.
 * A run's ref goes out when it is new to the subscription or differs from
 * the one sent, in the same message as the rows of that run, so a row never
 * arrives before what it names. A changed ref alone is a message with no
 * rows.
 */
export function serveLiveList<Row extends RowLike, E, SE, R>(
  runs: Stream.Stream<Run<ListRun<Row>, E>, SE, R>,
  options: ServeOptions & { readonly encodeRow: (row: Row) => unknown },
): Stream.Stream<ListDelta<Row>, E | SE, R> {
  let seq = 0
  let windowCovered: boolean | undefined
  let order: ReadonlyArray<string> = []
  let revById = new Map<string, number>()
  const sentPeople = new Map<string, Person>()
  const sentChannels = new Map<string, ChannelRef>()
  const sentArt = new Map<string, TopicArt>()
  return runs.pipe(
    Stream.mapEffect((outcome) =>
      Effect.gen(function* (): Generator<Effect.Effect<unknown, E>, Option.Option<ListDelta<Row>>> {
        const at = yield* Clock.currentTimeMillis
        if (Result.isFailure(outcome)) {
          if (seq === 0) return yield* Effect.fail(outcome.failure)
          const meta: LiveMeta = { seq: ++seq, queryMs: 0, encodeMs: 0, at, error: describe(outcome.failure) }
          return Option.some({ reset: false, order, upsert: [], remove: [], meta })
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
        const people = unsent(sentPeople, run.refs?.people)
        const channels = unsent(sentChannels, run.refs?.channels)
        const art = unsent(sentArt, run.refs?.art)
        const refs: Refs | undefined =
          people.length === 0 && channels.length === 0 && art.length === 0
            ? undefined
            : { ...(people.length === 0 ? {} : { people }), ...(channels.length === 0 ? {} : { channels }), ...(art.length === 0 ? {} : { art }) }
        if (windowCovered === run.windowCovered && !reset && upsert.length === 0 && remove.length === 0 && refs === undefined && sameOrder(order, nextOrder)) return Option.none()
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
        for (const person of people) sentPeople.set(person.id, person)
        for (const channel of channels) sentChannels.set(channel.id, channel)
        for (const drawing of art) sentArt.set(drawing.id, drawing)
        windowCovered = run.windowCovered
        const meta: LiveMeta = { ...(windowCovered === undefined ? {} : { windowCovered }), seq: ++seq, queryMs, encodeMs, at, ...(run.total === undefined ? {} : { total: run.total }) }
        return Option.some({ reset, order, upsert, remove, ...(refs === undefined ? {} : { refs }), meta })
      }),
    ),
    Stream.filter(Option.isSome),
    Stream.map((message) => message.value),
  )
}

/** The entries of `incoming` that `sent` lacks or holds with other values. */
function unsent<A extends { readonly id: string }>(sent: ReadonlyMap<string, A>, incoming: ReadonlyArray<A> | undefined): ReadonlyArray<A> {
  if (incoming === undefined) return []
  const out: Array<A> = []
  for (const entry of incoming) {
    const held = sent.get(entry.id)
    if (held === undefined || (held !== entry && !sameValue(held, entry))) out.push(entry)
  }
  return out
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

/** 0.5 s, doubling, at most 30 s apart. */
const FIRST_RUN_RETRY = Schedule.min([Schedule.exponential('500 millis'), Schedule.spaced('30 seconds')])

/**
 * For a served stream (`serveLiveValue`, `serveLiveList`): a failure, which
 * can only come from the first run, is logged and the stream starts again
 * with backoff, so a busy reader or a missing table at boot does not end the
 * subscription for good. The renderer keeps what it shows until a run
 * succeeds. Defects are not retried.
 */
export const retryFirstRun =
  (label: string, schedule: Schedule.Schedule<unknown, unknown> = FIRST_RUN_RETRY) =>
  <A, E, R>(served: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    served.pipe(
      Stream.tapError((error) => Effect.logWarning(`${label}: the first run failed; retrying`, error)),
      Stream.retry(schedule),
    )

/**
 * A live value that follows the open workspace, as Home's destination pickers and
 * the mention suggestions do: `query` re-runs on `keys` in whichever
 * workspace is open, and nothing is sent while none is. A failed first run
 * is retried (`retryFirstRun`).
 */
export const serveWorkspaceValue = <A, E, R>(changes: Stream.Stream<OpenWorkspace | undefined>, name: string, keys: InvalidationKeys, query: Effect.Effect<A, E, R>) =>
  serveLiveValue(
    changes.pipe(Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(keys, timed(query)).pipe(Stream.provide(open.context))))),
  ).pipe(retryFirstRun(name), Stream.orDie)
