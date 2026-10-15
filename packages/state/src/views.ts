/**
 * Sidebar views (spec section 5 "Views", architecture 7): the views in pill
 * order, the dot on each, and the view sheet's open state. Selecting a view
 * is `sidebarFilterAtom`'s `view`.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { viewsList, type ChannelRef, type SidebarView } from '@juno/contract'
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

/** A view's pill: what the filter row draws. */
export interface ViewPill {
  readonly id: string
  readonly name: string
  readonly icon?: SidebarView['icon']
  /** One of its topics has an unread mention of the user: the pill's dot. Plain unread does not count. */
  readonly mention: boolean
}

const samePills = (a: ReadonlyArray<ViewPill>, b: ReadonlyArray<ViewPill>): boolean =>
  a.length === b.length && a.every((pill, i) => pill.id === b[i]!.id && pill.name === b[i]!.name && pill.icon === b[i]!.icon && pill.mention === b[i]!.mention)

/**
 * The views' pills in order, with their dots. Equal lists do not notify, so
 * a count that changes without a dot changing re-renders nothing.
 */
export const viewPillsAtom = Atom.make((get): ReadonlyArray<ViewPill> => {
  const counts = get(topicCountsAtom(get(sidebarFilterAtom).scope))
  const held = Option.getOrUndefined(get.self<ReadonlyArray<ViewPill>>())
  // A new scope's counts are not in yet: keep each dot as it was.
  const mentions = AsyncResult.isSuccess(counts) ? new Set(counts.value.viewMentions) : new Set(held?.filter((pill) => pill.mention).map((pill) => pill.id))
  return get(viewsAtom).map((view) => ({ id: view.id, name: view.name, ...(view.icon === undefined ? {} : { icon: view.icon }), mention: mentions.has(view.id) }))
}).pipe(Atom.withEquality(samePills))

/** The view sheet (inventory 2.3): closed, a new view (maybe with a conversation in it already), or editing a view. */
export type ViewSheetState =
  | { readonly mode: 'new'; readonly channels: ReadonlyArray<Pick<ChannelRef, 'id' | 'name' | 'kind'>> }
  | { readonly mode: 'edit'; readonly id: string }

export const viewSheetAtom = Atom.make<ViewSheetState | undefined>(undefined).pipe(Atom.keepAlive)
