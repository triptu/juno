/**
 * Live query declarations (architecture sections 2.6 and 7, performance 2.2).
 *
 * Two kinds:
 *
 * - `liveQuery` streams a single value: the current one first, then every
 *   change. Use it for status, prefs, a topic detail.
 * - `liveList` streams a window of rows as `ListDelta`s: a first message with
 *   `reset: true` carrying the whole window, then only rows whose `rev`
 *   changed. The renderer keeps rows whose `rev` did not change, so
 *   `React.memo` holds and only changed rows are decoded. Subscriptions always
 *   cover a `Window`, never a whole history.
 *
 * Every message carries `LiveMeta` so the renderer can attribute the
 * write-to-pixels budget without a cross-process trace.
 *
 * Both are `effect/rpc` stream routes underneath. The kind is recorded as an
 * annotation so `@juno/state` can pick the right accumulation.
 */
import { Context, Schema } from 'effect'
import { Rpc } from 'effect/rpc'

export type LiveKind = 'value' | 'list'

/** Annotation on a stream route: how the renderer should accumulate it. */
export class LiveKindAnnotation extends Context.Service<LiveKindAnnotation, LiveKind>()('juno/contract/LiveKind') {}

export const liveKindOf = (rpc: Rpc.Any): LiveKind | undefined => Context.getOrUndefined(rpc.annotations, LiveKindAnnotation)

/** Size budgets for one live query message (performance section 1). */
export const LIVE_SNAPSHOT_MAX_BYTES = 200 * 1024
export const LIVE_DELTA_MAX_BYTES = 32 * 1024

/** A window into an ordered list: the row to start from and how many rows. */
export const Window = Schema.Struct({
  /** Id of the row the window starts at. Absent means the top of the list. */
  anchor: Schema.optionalKey(Schema.String),
  /** Number of rows after the anchor. Capped by the engine. */
  limit: Schema.Int,
})
export type Window = typeof Window.Type

/** Timing and ordering the engine stamps on every live query message. */
export const LiveMeta = Schema.Struct({
  /** 1 for the first message of a subscription, then +1 per message. */
  seq: Schema.Int,
  /** Milliseconds the engine spent running the query for this message. */
  queryMs: Schema.Number,
  /** Milliseconds the engine spent encoding the rows of this message. */
  encodeMs: Schema.Number,
  /** Engine clock (epoch milliseconds) when the message was built. */
  at: Schema.Number,
  /** Rows in the whole list, not just the window, when the engine knows. */
  total: Schema.optionalKey(Schema.Int),
  /** The last query run failed; the data shown is from the previous run. */
  error: Schema.optionalKey(Schema.String),
})
export type LiveMeta = typeof LiveMeta.Type

/** What every row in a `liveList` carries. */
export const RowFields = {
  id: Schema.String,
  /** Changes whenever any field of the row changes. */
  rev: Schema.Int,
}

/** One `liveQuery` message. */
export function LiveValue<Value extends Schema.Top>(value: Value) {
  return Schema.Struct({ value, meta: LiveMeta })
}
export type LiveValue<Value> = { readonly value: Value; readonly meta: LiveMeta }

/**
 * One `liveList` message. The first message of a subscription has
 * `reset: true`; `order` is then the complete window and `upsert` holds every
 * row in it. Later messages carry only rows whose `rev` changed, the ids that
 * left the window, and `order` (the same array contents when unchanged).
 */
export function ListDelta<Row extends Schema.Top>(row: Row) {
  return Schema.Struct({
    reset: Schema.Boolean,
    order: Schema.Array(Schema.String),
    upsert: Schema.Array(row),
    remove: Schema.Array(Schema.String),
    meta: LiveMeta,
  })
}
export type ListDelta<Row> = {
  readonly reset: boolean
  readonly order: ReadonlyArray<string>
  readonly upsert: ReadonlyArray<Row>
  readonly remove: ReadonlyArray<string>
  readonly meta: LiveMeta
}

/** Declares a single-value live query. */
export function liveQuery<const Tag extends string, Value extends Schema.Top, Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void>(
  tag: Tag,
  options: { readonly value: Value; readonly payload?: Payload },
) {
  return Rpc.make(tag, { payload: options.payload, success: LiveValue(options.value), stream: true }).annotate(
    LiveKindAnnotation,
    'value',
  )
}

/** Declares a windowed list live query. The payload must include a `window`. */
export function liveList<const Tag extends string, Row extends Schema.Top, Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void>(
  tag: Tag,
  options: { readonly row: Row; readonly payload?: Payload },
) {
  return Rpc.make(tag, { payload: options.payload, success: ListDelta(options.row), stream: true }).annotate(
    LiveKindAnnotation,
    'list',
  )
}
