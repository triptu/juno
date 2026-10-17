/**
 * The sidebar's held order (SPEC 5, "Holding the order"). While the pointer
 * or keyboard focus is in the topic list, rows keep their places: a row's
 * contents update in place, but moves, new rows and rows leaving wait for
 * the hold to end. Rows the user just acted on (`released`) take their
 * live place at once.
 */
import type { TopicRow } from '@juno/contract'
import type { ListWindow } from './list'

/** A row with the section it had when the hold began, kept by object so an unchanged row stays the same object. */
const sectioned = new WeakMap<TopicRow, TopicRow>()

function inSection(row: TopicRow, section: TopicRow['section']): TopicRow {
  if (row.section === section) return row
  const held = sectioned.get(row)
  if (held !== undefined && held.section === section) return held
  const next = { ...row, section }
  sectioned.set(row, next)
  return next
}

/**
 * The window to show while the list holds: `shown`'s order and sections,
 * with each row's contents from `live`. A row that left `live` stays with
 * its last contents, so nothing leaves a gap; a row new in `live` waits.
 * A released row takes its place by recency among the rows shown: before
 * the first one with older activity, else last. (Its neighbours in `live`
 * may be held elsewhere, so the live order cannot place it.) It goes when
 * `live` no longer has it.
 * Everything but the order and rows (refs, meta, retained) is `live`'s.
 */
export function holdOrder<W extends ListWindow<TopicRow>>(shown: ListWindow<TopicRow>, live: W, released: ReadonlySet<string>): W {
  const order: string[] = []
  const rows = new Map<string, TopicRow>()
  for (const id of shown.order) {
    if (released.has(id)) continue
    const old = shown.rows.get(id)
    if (old === undefined) continue
    const now = live.rows.get(id)
    rows.set(id, now === undefined ? old : inSection(now, old.section))
    order.push(id)
  }
  for (const id of released) {
    const row = live.rows.get(id)
    if (row === undefined) continue
    const at = order.findIndex((other) => rows.get(other)!.lastActivityAt < row.lastActivityAt)
    order.splice(at < 0 ? order.length : at, 0, id)
    rows.set(id, row)
  }
  const same = order.length === shown.order.length && order.every((id, i) => id === shown.order[i])
  return { ...live, order: same ? shown.order : order, rows }
}
