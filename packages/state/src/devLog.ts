/**
 * The developer log page (`devLog.*` routes): the filter, how many rows to
 * ask for, and the entry that is open. The list subscription lives only
 * while the page reads it, so the engine does no work for the log otherwise.
 *
 * `devLogListAtom` holds the window shown until a new filter's first
 * snapshot arrives, as `allTopicsListAtom` does, so typing in the filter
 * never shows an empty list in between.
 */
import { Option } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { devLogEntry, devLogList, type DevLogDetail, type DevLogFilter, type DevLogRow } from '@juno/contract'
import { liveQuery } from './atoms'
import { emptyWindow, type ListWindow } from './list'

/** Rows asked for at first, and added by each "Show older entries". */
export const DEV_LOG_PAGE = 500

export const devLogFilterAtom = Atom.make<DevLogFilter>({ kinds: [], errorsOnly: false, text: '' }).pipe(Atom.keepAlive)
export const devLogLimitAtom = Atom.make(DEV_LOG_PAGE).pipe(Atom.keepAlive)

const listFamily = liveQuery(devLogList)

/** The current filter's window once it has a snapshot, otherwise the last one shown. */
export const devLogListAtom = Atom.make((get): ListWindow<DevLogRow> => {
  const filter = get(devLogFilterAtom)
  const limit = get(devLogLimitAtom)
  const result = get(listFamily({ filter, range: { limit } }))
  const shown = Option.getOrUndefined(get.self<ListWindow<DevLogRow>>())
  if (!AsyncResult.isSuccess(result) || result.value.meta.seq === 0) return shown ?? emptyWindow<DevLogRow>()
  return result.value
})

const entryFamily = liveQuery(devLogEntry)
const noEntry = Atom.make<DevLogDetail | null | undefined>(undefined)
const openEntry = Atom.family((id: string) =>
  Atom.make((get): DevLogDetail | null | undefined => {
    const result = get(entryFamily({ id }))
    return AsyncResult.isSuccess(result) ? result.value : undefined
  }),
)

/** The open entry with its params, timing and response summary: undefined while none is open or it loads, null once it has left the log. */
export const devLogDetailAtom = (id: string | undefined) => (id === undefined ? noEntry : openEntry(id))
