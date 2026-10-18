/**
 * Tests only: a record of a send's path through the renderer, so a test
 * that sends and then misses the message in a tab says where it got to
 * (`apps/desktop/e2e/README.md`, "Send trace").
 *
 * Off unless the e2e harness puts an empty trace on the window
 * (`globalThis.__junoSendTrace`). Then the send command, the background tab
 * Home opens or reuses, each tab change the navigation asks for and applies,
 * the topic views that mount, and each new message window a view gets
 * append one timestamped entry. Off, each of those costs one property read;
 * nothing is kept. Entries hold ids, states and counts, never message text.
 */
import type { MessageView } from '@juno/contract'

export interface SendTrace {
  /** The last entries, oldest first. `at` is `Date.now()`. */
  readonly events: Array<{ readonly at: number; readonly what: string; readonly [key: string]: unknown }>
}

const KEPT = 120

const trace = (): SendTrace | undefined => (globalThis as { __junoSendTrace?: SendTrace }).__junoSendTrace

/** Appends `what` with `detail`, read only while tracing. */
export function traceSend(what: string, detail?: () => Record<string, unknown>): void {
  const on = trace()
  if (on === undefined) return
  on.events.push({ at: Date.now(), what, ...detail?.() })
  if (on.events.length > KEPT) on.events.shift()
}

/** The window values each view last traced, so the same value read again does not count. */
const lastWindow = new Map<string, unknown>()

/**
 * A view got a message window. Records its seq, row count, the newest row
 * and the send state of the rows sent from this app (pending rows come last).
 */
export function traceWindow(view: string, value: { readonly meta: { readonly seq: number }; readonly order: ReadonlyArray<string>; readonly rows: ReadonlyMap<string, MessageView> }, spec: unknown): void {
  if (trace() === undefined || lastWindow.get(view) === value.meta) return
  lastWindow.set(view, value.meta)
  const sent: Array<string> = []
  for (const ts of value.order.slice(-4)) {
    const row = value.rows.get(ts)
    if (row?.clientMsgId !== undefined) sent.push(`${row.clientMsgId.slice(0, 8)}:${row.pending ?? 'stored'}:${ts.startsWith('pending:') ? 'pending' : ts}`)
  }
  traceSend('window', () => ({ view: view.replace('\u0000', '@'), seq: value.meta.seq, rows: value.order.length, last: value.order.at(-1)?.slice(0, 24), sent, spec }))
}
