/**
 * UI-only state for the sidebar (architecture 7): the quick filters and
 * scope, the current selection, and the minute clock the row times read.
 * None of it is persisted; the filters reset to All on launch and the
 * selection follows the tabs once they exist (M4).
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import type { TopicRow } from '@juno/contract'
import type { LiveListAtom } from './atoms'
import { emptyWindow } from './list'
import { defaultTopicListFilter, type TopicListFilter } from './topics'

/** The quick filters (All, Channels, DMs, Unread) and the scope chip. */
export const sidebarFilterAtom = Atom.make<TopicListFilter>(defaultTopicListFilter).pipe(Atom.keepAlive)

/** The row the user picked last. Opening it is M4; until then it only marks the row. */
export const selectedTopicAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)

/** Whether one row is the selection. Only the rows whose answer changes are notified. */
export const topicSelectedAtom = Atom.family((id: string) => Atom.make((get) => get(selectedTopicAtom) === id))

/** How often the row times are refreshed. Relative times change by the minute. */
const CLOCK_TICK_MS = 30_000

/**
 * Wall-clock milliseconds, refreshed every half minute while something
 * reads it. Row owners format `lastActivityAt` against it and pass the
 * string down, so a tick re-renders the thin owners, not the rows
 * (performance.md 5.1).
 */
export const nowAtom = Atom.make<number>((get) => {
  const timer = setInterval(() => get.setSelf(Date.now()), CLOCK_TICK_MS)
  get.addFinalizer(() => clearInterval(timer))
  return Date.now()
}).pipe(Atom.keepAlive)

export interface SidebarSections {
  /** False until the first snapshot has arrived, so an empty list is not mistaken for an empty window. */
  readonly ready: boolean
  readonly pinned: ReadonlyArray<string>
  readonly recent: ReadonlyArray<string>
  /** The engine's count of rows in the whole list, when it knows it. */
  readonly total: number | undefined
}

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const sameSections = (a: SidebarSections, b: SidebarSections): boolean =>
  a.ready === b.ready && a.total === b.total && sameIds(a.pinned, b.pinned) && sameIds(a.recent, b.recent)

/**
 * The window's order split into Pinned and Recent, for the list container.
 * Equal splits do not notify, so a delta that only edits a row (a new
 * preview, a count) re-renders that row and nothing else.
 */
export const sidebarSectionsAtom = Atom.family(<E>(list: LiveListAtom<TopicRow, E>) =>
  Atom.make((get): SidebarSections => {
    const window = AsyncResult.getOrElse(get(list), () => emptyWindow<TopicRow>())
    const pinned: string[] = []
    const recent: string[] = []
    for (const id of window.order) {
      const row = window.rows.get(id)
      if (row === undefined) continue
      if (row.section === 'pinned') pinned.push(id)
      else recent.push(id)
    }
    return { ready: window.meta.seq > 0, pinned, recent, total: window.meta.total }
  }).pipe(Atom.withEquality(sameSections)),
)
