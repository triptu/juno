/**
 * The renderer's copy of a `liveList` window (performance.md 5.2).
 *
 * Rows live in a `Map` by id. A delta replaces only the rows it carries, so a
 * row whose `rev` did not change keeps its object and `React.memo` holds.
 * `order` keeps its array when the contents did not change, so a container
 * that subscribes to `order` only does not re-render for a row edit. A
 * `reset` (a fresh snapshot after a reconnect or an engine restart) keeps
 * the objects of rows whose `rev` it repeats, so it re-renders only what
 * changed while the port was down.
 */
import type { ListDelta, LiveMeta } from '@juno/contract'

export interface ListWindow<Row> {
  readonly order: ReadonlyArray<string>
  readonly rows: ReadonlyMap<string, Row>
  readonly meta: LiveMeta
}

export const emptyWindow = <Row>(): ListWindow<Row> => ({
  order: [],
  rows: new Map(),
  meta: { seq: 0, queryMs: 0, encodeMs: 0, at: 0 },
})

export function applyListDelta<Row extends { readonly id: string; readonly rev: number }>(
  previous: ListWindow<Row>,
  delta: ListDelta<Row>,
): ListWindow<Row> {
  const rows = new Map<string, Row>(delta.reset ? undefined : previous.rows)
  for (const id of delta.remove) rows.delete(id)
  for (const row of delta.upsert) {
    const existing = previous.rows.get(row.id)
    rows.set(row.id, existing !== undefined && existing.rev === row.rev ? existing : row)
  }
  const order = sameOrder(previous.order, delta.order) ? previous.order : delta.order
  return { order, rows, meta: delta.meta }
}

/** Same ids in the same order. */
export function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
