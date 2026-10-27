/**
 * The sidebar list's order split into Pinned and Recent, for the list
 * container (architecture 7), and whether its last change may slide
 * (`sidebarMoves.ts`).
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { sameOrder } from './list'
import { sidebarInstantAtom, sidebarListAtom } from './sidebar'
import type { sidebarMoves, SidebarMoves } from './sidebarMoves'
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

const sameSections = (a: Omit<SidebarSections, 'moves'>, b: Omit<SidebarSections, 'moves'>): boolean =>
  a.ready === b.ready && a.total === b.total && a.filter === b.filter && sameOrder(a.pinned, b.pinned) && sameOrder(a.recent, b.recent)

/**
 * The shown window's order split into Pinned and Recent, for the list
 * container. Equal splits do not notify, so a delta that only edits a row
 * (a new preview, a count) re-renders that row and nothing else. A new
 * split says whether its change may slide (`moves`).
 */
let moves: typeof sidebarMoves | undefined

/** Loaded on idle by the sidebar; earlier changes simply take their places. */
export async function loadSidebarMoves(): Promise<void> {
  moves = (await import('./sidebarMoves')).sidebarMoves
}

interface TrackedSections extends SidebarSections { readonly instant: number }

// Keep bookkeeping even when the shown order is equal (a row can become retained without moving).
const trackedSectionsAtom = Atom.make((get): TrackedSections => {
  const window = get(sidebarListAtom)
  const instant = get(sidebarInstantAtom)
  const pinned: string[] = []
  const recent: string[] = []
  for (const id of window.order) {
    const row = window.rows.get(id)
    if (row === undefined) continue
    if (row.section === 'pinned') pinned.push(id)
    else recent.push(id)
  }
  const ready = window.meta.seq > 0 && window.meta.windowCovered !== false
  const next = { ready, pinned, recent, total: window.meta.total, filter: window.filter, retained: window.retained, instant }
  const before = Option.getOrUndefined(get.self<TrackedSections>())
  const changed = before === undefined || !sameSections(before, next)
  // A settle after a sync cycle carries the last write's `meta`, but moves only rows held for changes from elsewhere.
  const own = (window.meta.own === true && window.settled !== true) || before?.instant !== instant
  return { ...next, moves: changed ? moves?.(before, next, own, window.building === true) ?? 'instant' : before.moves }
})

export const sidebarSectionsAtom = Atom.make((get) => get(trackedSectionsAtom)).pipe(Atom.withEquality(sameSections))
