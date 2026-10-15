/**
 * Sidebar views (spec section 5 "Views", architecture 7): the views in pill
 * order, the dot on each, and the view sheet's open state. Selecting a view
 * is `sidebarFilterAtom`'s `view`.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { viewsList, type SidebarView } from '@juno/contract'
import { liveQuery } from './atoms'
import { sidebarFilterAtom } from './sidebar'
import { topicCountsAtom } from './topics'

const viewsResultAtom = liveQuery(viewsList)(undefined)

const noViews: ReadonlyArray<SidebarView> = []

/** Every view in pill order; empty until the first value arrives, then the last value while a new one is on its way. */
export const viewsAtom = Atom.make((get): ReadonlyArray<SidebarView> => {
  const result = get(viewsResultAtom)
  if (AsyncResult.isSuccess(result)) return result.value
  return Option.getOrElse(get.self<ReadonlyArray<SidebarView>>(), () => noViews)
})

/**
 * Whether a view's pill shows its dot: one of its topics has an unread
 * mention. A boolean, so a count that changes without the dot changing
 * re-renders nothing.
 */
export const viewDotAtom = Atom.family((id: string) =>
  Atom.make((get): boolean => {
    const counts = get(topicCountsAtom(get(sidebarFilterAtom).scope))
    if (!AsyncResult.isSuccess(counts)) return Option.getOrElse(get.self<boolean>(), () => false)
    return counts.value.viewMentions.includes(id)
  }),
)

/** The view sheet (inventory 2.3): closed, a new view (maybe with a conversation in it already), or editing a view. */
export type ViewSheetState =
  | { readonly mode: 'new'; readonly channels: ReadonlyArray<string> }
  | { readonly mode: 'edit'; readonly id: string }

export const viewSheetAtom = Atom.make<ViewSheetState | undefined>(undefined).pipe(Atom.keepAlive)
