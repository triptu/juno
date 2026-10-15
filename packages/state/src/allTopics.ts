/**
 * State for the All topics page (spec section 11, architecture 7): the
 * filters, the window the page asks for, and the atoms its table and rows
 * subscribe to.
 *
 * The list can hold thousands of topics, so the page subscribes to one
 * window of `ALL_TOPICS_WINDOW` rows at `allTopicsOffsetAtom` and draws a
 * virtual list of `meta.total` rows; the rows outside the window draw as
 * placeholders until the page moves the window to them.
 *
 * `allTopicsListAtom` holds the window shown until the next one's first
 * snapshot arrives, as `sidebarListAtom` does, so a filter change or a
 * window move replaces the rows in one step and never shows an empty table
 * (performance 5.3). Rows keep their objects while their `rev` holds, and
 * each row atom is keyed by id alone, so only rows that change re-render.
 * The summary (the chips' counts and the place select) is held the same way.
 */
import { Option } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { ALL_TOPICS_WINDOW, allTopicsList, allTopicsSummary, type AllTopicsFilter, type AllTopicsSummary, type TopicRow } from '@juno/contract'
import { liveQuery } from './atoms'
import { emptyWindow, sameOrder, type ListWindow } from './list'
import { carryOver } from './sidebar'
import { joinTopicWindow } from './topics'

export const defaultAllTopicsFilter: AllTopicsFilter = { status: 'all', kind: 'all', sort: 'recent' }

/** The page's filters. Kept for the session, so the page reopens as it was left. */
export const allTopicsFilterAtom = Atom.make<AllTopicsFilter>(defaultAllTopicsFilter).pipe(Atom.keepAlive)

/** The index of the first row of the window the page asks for. The page moves it as it scrolls, and back to 0 with a new filter. */
export const allTopicsOffsetAtom = Atom.make(0).pipe(Atom.keepAlive)

/** The filter as the engine takes it: a blank text filter and no place are left out, so equal filters share one subscription. */
function wireFilter(filter: AllTopicsFilter): AllTopicsFilter {
  const query = filter.query?.trim() ?? ''
  return {
    status: filter.status,
    kind: filter.kind,
    sort: filter.sort,
    ...(filter.scope === undefined ? {} : { scope: filter.scope }),
    ...(query === '' ? {} : { query }),
  }
}

const listFamily = liveQuery(allTopicsList)
const summaryFamily = liveQuery(allTopicsSummary)

const joinedFamily = Atom.family((key: string) => {
  const wire = listFamily(JSON.parse(key) as Parameters<typeof listFamily>[0])
  return Atom.make((get) => AsyncResult.map(get(wire), joinTopicWindow))
})

/** One window of All topics, joined into `TopicRow`s. */
export const allTopicsWindowAtom = (filter: AllTopicsFilter, offset: number) =>
  joinedFamily(JSON.stringify({ ...wireFilter(filter), offset, range: { limit: ALL_TOPICS_WINDOW } }))

/** The window the page shows, with the filter and offset it belongs to. Both lag the atoms until the new window's first snapshot. */
export interface AllTopicsWindow extends ListWindow<TopicRow> {
  readonly filter: AllTopicsFilter
  readonly offset: number
}

/** The current filter and offset's window once it has a snapshot, otherwise the last one shown. `meta.seq` is 0 only before the first snapshot ever. */
export const allTopicsListAtom = Atom.make((get): AllTopicsWindow => {
  const filter = get(allTopicsFilterAtom)
  const offset = get(allTopicsOffsetAtom)
  const result = get(allTopicsWindowAtom(filter, offset))
  const shown = Option.getOrUndefined(get.self<AllTopicsWindow>())
  if (!AsyncResult.isSuccess(result) || result.value.meta.seq === 0 || result.value.meta.windowCovered === false) return shown ?? { ...emptyWindow<TopicRow>(), filter, offset }
  return { ...carryOver(shown, result.value), filter, offset }
})

/** One row of All topics by id. Notifies only when the row's object changes. */
export const allTopicsRowAtom = Atom.family((id: string) =>
  Atom.make((get): TopicRow | undefined => get(allTopicsListAtom).rows.get(id)).pipe(Atom.withEquality((a, b) => a === b)),
)

/** What the table needs to lay itself out: how many rows, and which ids sit where. */
export interface AllTopicsLayout {
  /** False until the first window has arrived. */
  readonly ready: boolean
  /** Rows in the whole list. */
  readonly total: number
  /** The index of `order[0]` in the whole list. */
  readonly offset: number
  readonly order: ReadonlyArray<string>
  /** The filter of the rows shown. */
  readonly filter: AllTopicsFilter
}

const sameLayout = (a: AllTopicsLayout, b: AllTopicsLayout) =>
  a.ready === b.ready && a.total === b.total && a.offset === b.offset && a.filter === b.filter && sameOrder(a.order, b.order)

/** The shown window's layout. A delta that only edits rows does not notify, so the table does not re-render for it. */
export const allTopicsLayoutAtom = Atom.make((get): AllTopicsLayout => {
  const window = get(allTopicsListAtom)
  return { ready: window.meta.seq > 0, total: window.meta.total ?? window.order.length, offset: window.offset, order: window.order, filter: window.filter }
}).pipe(Atom.withEquality(sameLayout))

const emptySummary: AllTopicsSummary = { counts: { all: 0, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 }, places: [] }

/** The chips' counts and the place select's conversations for the current filter, held while a new filter's summary is on its way. */
export const allTopicsSummaryAtom = Atom.make((get): AllTopicsSummary => {
  const { kind, scope, query } = wireFilter(get(allTopicsFilterAtom))
  const result = get(summaryFamily({ kind, ...(scope === undefined ? {} : { scope }), ...(query === undefined ? {} : { query }) }))
  if (AsyncResult.isSuccess(result)) return result.value
  return Option.getOrElse(get.self<AllTopicsSummary>(), () => emptySummary)
})
