/**
 * Tests only: a record of the sidebar's order hold and of the topic list
 * values it was given, so a sidebar e2e that fails says why its rows did not
 * change (`apps/desktop/e2e/README.md`, "Sidebar trace").
 *
 * Off unless the e2e harness puts an empty trace on the window
 * (`globalThis.__junoSidebarTrace`). Then each change of the hold's inputs
 * appends one entry with the state at that moment, and each list value counts,
 * with its error when the engine's run failed. Off, a change costs one
 * property read and a list value another; nothing is kept.
 */
import type { LiveMeta } from '@juno/contract'

/** The hold's inputs after a change (`sidebar.ts`). */
export interface HoldState {
  readonly engaged: boolean
  readonly paused: boolean
  readonly sheets: number
  readonly released: number
}

export interface SidebarTrace {
  /** The last changes of the hold's inputs, oldest first. */
  readonly hold: Array<{ readonly at: number; readonly what: string } & HoldState>
  /** The topic list values the sidebar was given: how many, how many said the run failed, and the last of each. */
  readonly list: { values: number; errors: number; last?: { at: number; seq: number; rows: number; filter: string }; lastError?: { at: number; seq: number; error: string } }
}

const KEPT = 60

const trace = (): SidebarTrace | undefined => (globalThis as { __junoSidebarTrace?: SidebarTrace }).__junoSidebarTrace

/** A hold input changed: `what`, and the state after it, both read only while tracing. */
export function traceHold(what: string | (() => string), state: () => HoldState): void {
  const on = trace()
  if (on === undefined) return
  on.hold.push({ at: Date.now(), what: typeof what === 'string' ? what : what(), ...state() })
  if (on.hold.length > KEPT) on.hold.shift()
}

let lastMeta: LiveMeta | undefined

/** A topic list value reached the sidebar. The same value read again does not count. */
export function traceList(meta: LiveMeta, rows: number, filter: unknown): void {
  const on = trace()
  if (on === undefined || meta === lastMeta) return
  lastMeta = meta
  on.list.values++
  on.list.last = { at: Date.now(), seq: meta.seq, rows, filter: JSON.stringify(filter) }
  if (meta.error === undefined) return
  on.list.errors++
  on.list.lastError = { at: Date.now(), seq: meta.seq, error: meta.error }
}
