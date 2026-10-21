/**
 * The developer log (a hidden page, opened from ⌘K with "developer"): what
 * the engine is doing right now. Every Slack call, socket event and sync
 * step, newest first, from a ring buffer in the engine's memory.
 *
 * It is never written to disk, the engine log, Copy log, crash reports or
 * anything sent off the machine (`docs/architecture.md`, "Developer log").
 * Params can hold the user's own message text, cut short; secrets are
 * removed before an entry is kept.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveListRoute, liveValueRoute, RowFields } from '../live'

export const DevLogKind = Schema.Literals(['slack', 'socket', 'sync'])
export type DevLogKind = typeof DevLogKind.Type

/** Entries the engine keeps; the oldest goes when a new one arrives. */
export const DEV_LOG_CAPACITY = 2000

export const DevLogRow = Schema.Struct({
  ...RowFields,
  /** When it started or arrived, in epoch milliseconds. */
  at: Schema.Number,
  kind: DevLogKind,
  /** The method, the event type or the sync step. */
  name: Schema.String,
  /** The lane and reason of a call, the channel of an event. '' when none. */
  context: Schema.String,
  /** Null while a call runs, and for an instant event. */
  durationMs: Schema.NullOr(Schema.Number),
  /** `ok`, `running`, a Slack error code, or a short description. */
  outcome: Schema.String,
  failed: Schema.Boolean,
})
export type DevLogRow = typeof DevLogRow.Type

export const DevLogFilter = Schema.Struct({
  /** Empty means every kind. */
  kinds: Schema.Array(DevLogKind),
  errorsOnly: Schema.Boolean,
  /** Matched, ignoring case, against the name, context and outcome. */
  text: Schema.String,
})
export type DevLogFilter = typeof DevLogFilter.Type

export const devLogList = liveListRoute('devLog.list', { row: DevLogRow, payload: { filter: DevLogFilter } })

export const DevLogSection = Schema.Struct({
  title: Schema.String,
  lines: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
})
export type DevLogSection = typeof DevLogSection.Type

/** One entry with its params, response summary and timing, for its expanded row. */
export const DevLogDetail = Schema.Struct({
  row: DevLogRow,
  sections: Schema.Array(DevLogSection),
})
export type DevLogDetail = typeof DevLogDetail.Type

/** Null once the entry has left the buffer. */
export const devLogEntry = liveValueRoute('devLog.entry', { value: Schema.NullOr(DevLogDetail), payload: { id: Schema.String } })

export const DevLogRoutes = RpcGroup.make(devLogList, devLogEntry)
