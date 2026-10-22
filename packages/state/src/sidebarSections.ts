/**
 * The sidebar list's order split into Pinned and Recent, for the list
 * container (architecture 7), and whether its last change may slide
 * (`sidebarMoves.ts`).
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { sameOrder } from './list'
import { sidebarListAtom } from './sidebar'
import { sidebarMoves, sidebarOwnAtom, type SidebarMoves } from './sidebarMoves'
import type { TopicListFilter } from './topics'

export interface SidebarSections {
  /** False until the first snapshot has arrived, so an empty list is not mistaken for an empty window. */
  readonly ready: boolean
  readonly pinned: ReadonlyArray<string>
  readonly recent: ReadonlyArray<string>
  /** The engine's count of rows in the whole list, when it knows it. */
  readonly total: number | undefined
  /** The filter of the rows shown, for the empty state. */
  readonly filter: TopicListFilter
  /** Rows kept only because a tab shows them. */
  readonly retained?: ReadonlySet<string> | undefined
  /** How the change to this order shows: sliding when it came from elsewhere, at once when it was yours (`sidebarMoves.ts`). */
  readonly moves: SidebarMoves
}

const sameSections = (a: SidebarSections, b: SidebarSections): boolean =>
  a.ready === b.ready && a.total === b.total && a.filter === b.filter && sameOrder(a.pinned, b.pinned) && sameOrder(a.recent, b.recent)

/**
 * The shown window's order split into Pinned and Recent, for the list
 * container. Equal splits do not notify, so a delta that only edits a row
 * (a new preview, a count) re-renders that row and nothing else. A new
 * split says whether its change may slide (`moves`).
 */
export const sidebarSectionsAtom = Atom.make((get): SidebarSections => {
  const window = get(sidebarListAtom)
  const own = get(sidebarOwnAtom)
  const pinned: string[] = []
  const recent: string[] = []
  for (const id of window.order) {
    const row = window.rows.get(id)
    if (row === undefined) continue
    if (row.section === 'pinned') pinned.push(id)
    else recent.push(id)
  }
  const ready = window.meta.seq > 0 && window.meta.windowCovered !== false
  const next = { ready, pinned, recent, total: window.meta.total, filter: window.filter, retained: window.retained }
  const before = Option.getOrUndefined(get.self<SidebarSections>())
  return { ...next, moves: sidebarMoves(before, next, own, Date.now(), window.building === true) }
}).pipe(Atom.withEquality(sameSections))
