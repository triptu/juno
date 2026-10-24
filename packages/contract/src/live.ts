/**
 * Live query declarations (architecture sections 2.6 and 7, performance 2.2).
 *
 * Two kinds:
 *
 * - `liveValueRoute` streams a single value: the current one first, then
 *   every change. Use it for status, prefs, a topic detail.
 * - `liveListRoute` streams a window of rows as `ListDelta`s: a first message
 *   with `reset: true` carrying the whole window, then only rows whose `rev`
 *   changed. The renderer keeps rows whose `rev` did not change, so
 *   `React.memo` holds and only changed rows are decoded. Subscriptions always
 *   cover a `ListRange`, never a whole history; the route adds `range` to its
 *   payload itself.
 *
 * Every message carries `LiveMeta` so the renderer can attribute the
 * write-to-pixels budget without a cross-process trace.
 *
 * Both are `effect/rpc` stream routes underneath. The kind is recorded as an
 * annotation so `@juno/state` can pick the right accumulation.
 */
import { Context, Schema } from 'effect'
import { Rpc } from 'effect/rpc'
import { Refs } from './refs'

export type LiveKind = 'value' | 'list'

/** Annotation on a stream route: how the renderer should accumulate it. */
export class LiveKindAnnotation extends Context.Service<LiveKindAnnotation, LiveKind>()('juno/contract/LiveKind') {}

export const liveKindOf = (rpc: Rpc.Any): LiveKind | undefined => Context.getOrUndefined(rpc.annotations, LiveKindAnnotation)

/** Size budgets for one live query message (performance section 1). Rows only; `refs` are counted separately. */
export const LIVE_SNAPSHOT_MAX_BYTES = 200 * 1024
export const LIVE_DELTA_MAX_BYTES = 32 * 1024

/** A range of an ordered list: the row to start from and how many rows. */
export const ListRange = Schema.Struct({
  /** Id of the row the range starts at. Absent means the top of the list. */
  anchor: Schema.optionalKey(Schema.String),
  /** Number of rows after the anchor. Capped by the engine. */
  limit: Schema.Int,
})
export type ListRange = typeof ListRange.Type

/** Timing and ordering the engine stamps on every live query message. */
export const LiveMeta = Schema.Struct({
  /** 1 for the first message of a subscription, then +1 per message. */
  seq: Schema.Int,
  /** Milliseconds the engine spent running the query for this message. */
  queryMs: Schema.Number,
  /**
   * Milliseconds the engine spent encoding the rows of this message. Measured
   * only in dev and e2e builds; 0 otherwise, because measuring encodes every
   * row twice.
   */
  encodeMs: Schema.Number,
  /** Engine clock (epoch milliseconds) when the message was built. */
  at: Schema.Number,
  /** This update includes a write from a renderer command; its movement is instant. */
  own: Schema.optionalKey(Schema.Boolean),
  /** Rows in the whole list, not just the window, when the engine knows. */
  total: Schema.optionalKey(Schema.Int),
  /** The initial window is covered: fetched message history, or completed cold sync for topic-list membership. */
  windowCovered: Schema.optionalKey(Schema.Boolean),
  /** The window holds the list's newest row. A window around an anchor can, when the rows after the anchor fit in it. */
  atNewest: Schema.optionalKey(Schema.Boolean),
  /**
   * A thread's window stops before replies the store cannot prove continuous
   * with its first row: scrolling up asks for them (`messages.loadOlder`).
   */
  gapBefore: Schema.optionalKey(Schema.Boolean),
  /**
   * A thread's window stops before replies the store cannot prove continuous
   * with its last row, or cannot prove its last row is the newest: scrolling
   * down asks for them (`messages.loadNewer`).
   */
  gapAfter: Schema.optionalKey(Schema.Boolean),
  /** The last query run failed; the data shown is from the previous run. */
  error: Schema.optionalKey(Schema.String),
})
export type LiveMeta = typeof LiveMeta.Type

/** What every row in a `liveListRoute` carries. */
export const RowFields = {
  id: Schema.String,
  /** Changes whenever any field of the row changes. */
  rev: Schema.Int,
}

/** One `liveValueRoute` message. */
export function LiveValue<Value extends Schema.Top>(value: Value) {
  return Schema.Struct({ value, meta: LiveMeta })
}
export type LiveValue<Value> = { readonly value: Value; readonly meta: LiveMeta }

/**
 * One `liveListRoute` message. The first message of a subscription has
 * `reset: true`; `order` is then the complete window and `upsert` holds every
 * row in it. Later messages carry only rows whose `rev` changed, the ids that
 * left the window, and `order` (the same array contents when unchanged).
 *
 * `refs` carries the people and channels the rows name by id (`refs.ts`):
 * each one the first time the subscription needs it and again when it
 * changes, never otherwise. The renderer applies them before the rows of
 * the same message, so a row never arrives before what it names. A change
 * to a person alone is a message with `refs` and no rows.
 */
export function ListDelta<Row extends Schema.Top>(row: Row) {
  return Schema.Struct({
    reset: Schema.Boolean,
    order: Schema.Array(Schema.String),
    upsert: Schema.Array(row),
    remove: Schema.Array(Schema.String),
    refs: Schema.optionalKey(Refs),
    meta: LiveMeta,
  })
}
export type ListDelta<Row> = {
  readonly reset: boolean
  readonly order: ReadonlyArray<string>
  readonly upsert: ReadonlyArray<Row>
  readonly remove: ReadonlyArray<string>
  readonly refs?: Refs
  readonly meta: LiveMeta
}

/** Declares a single-value live query. */
export function liveValueRoute<
  const Tag extends string,
  Value extends Schema.Top,
  Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void,
>(tag: Tag, options: { readonly value: Value; readonly payload?: Payload }) {
  return Rpc.make(tag, { payload: options.payload, success: LiveValue(options.value), stream: true }).annotate(
    LiveKindAnnotation,
    'value',
  )
}

/**
 * Declares a windowed list live query. The payload is the given fields plus
 * `range: ListRange`, so every list subscription has a range by construction.
 */
export function liveListRoute<const Tag extends string, Row extends Schema.Top, Payload extends Schema.Struct.Fields = {}>(
  tag: Tag,
  options: { readonly row: Row; readonly payload?: Payload },
) {
  const payload = { ...(options.payload ?? ({} as Payload)), range: ListRange }
  return Rpc.make(tag, { payload, success: ListDelta(options.row), stream: true }).annotate(LiveKindAnnotation, 'list')
}
