/**
 * Sidebar views (spec section 5 "Views", architecture 7): the views in pill
 * order, the dot on each, and the view sheet's open state. Selecting a view
 * is `sidebarFilterAtom`'s `view`.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { builtinPillLooks, PILL_LOOKS_PREF, PILL_ORDER_PREF, pillOrder, prefsGet, prefsSet, savedPillLook, viewsList, type BuiltinPill, type ChannelRef, type PillLook, type SidebarView } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
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

const savedPillOrderAtom = liveQuery(prefsGet)({ key: PILL_ORDER_PREF })
const savedPillLooksAtom = liveQuery(prefsGet)({ key: PILL_LOOKS_PREF })

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Every pill after All in order, by id: Channels, DMs and Reactions
 * (`BUILTIN_PILLS`) among the views (SPEC 5, "Quick filters"). A workspace
 * preference holds it, so a dragged pill keeps its place across a relaunch.
 */
export const pillOrderAtom = Atom.make((get): ReadonlyArray<string> => {
  const result = get(savedPillOrderAtom)
  // While a new value is on its way the order shown holds.
  const saved: unknown = AsyncResult.isSuccess(result) ? result.value : Option.getOrUndefined(get.self<ReadonlyArray<string>>())
  return pillOrder(get(viewsAtom).map((view) => view.id), saved)
}).pipe(Atom.withEquality(sameIds))

/** How Channels, DMs and Reactions are drawn: an icon and a colour each, which Edit view on their pill changes. */
export const pillLooksAtom = Atom.make((get): Readonly<Record<BuiltinPill, PillLook>> => {
  const result = get(savedPillLooksAtom)
  if (AsyncResult.isSuccess(result)) return builtinPillLooks(result.value)
  return Option.getOrElse(get.self<Readonly<Record<BuiltinPill, PillLook>>>(), () => builtinPillLooks(undefined))
})

/** Saves the order of every pill after All. */
export function savePillOrder(registry: Registry, order: ReadonlyArray<string>) {
  return runCommand(registry, prefsSet, { key: PILL_ORDER_PREF, value: [...order] })
}

/** Saves a built-in pill's icon and colour. */
export function savePillLook(registry: Registry, id: BuiltinPill, look: PillLook) {
  const saved = registry.get(savedPillLooksAtom)
  const before = AsyncResult.isSuccess(saved) && typeof saved.value === 'object' && saved.value !== null && !Array.isArray(saved.value) ? saved.value : {}
  return runCommand(registry, prefsSet, { key: PILL_LOOKS_PREF, value: { ...before, [id]: savedPillLook(look) } })
}

/** A view's pill: what the filter row draws. */
export interface ViewPill {
  readonly id: string
  readonly name: string
  readonly icon?: SidebarView['icon']
  /** The icon's colour; absent is neutral. */
  readonly color?: SidebarView['color']
  /** One of its topics has an unread mention of the user: the pill's dot. Plain unread does not count. */
  readonly mention: boolean
}

const samePills = (a: ReadonlyArray<ViewPill>, b: ReadonlyArray<ViewPill>): boolean =>
  a.length === b.length && a.every((pill, i) => pill.id === b[i]!.id && pill.name === b[i]!.name && pill.icon === b[i]!.icon && pill.color === b[i]!.color && pill.mention === b[i]!.mention)

/**
 * The views' pills in order, with their dots. Equal lists do not notify, so
 * a count that changes without a dot changing re-renders nothing.
 */
export const viewPillsAtom = Atom.make((get): ReadonlyArray<ViewPill> => {
  const counts = get(topicCountsAtom(get(sidebarFilterAtom).scope))
  const held = Option.getOrUndefined(get.self<ReadonlyArray<ViewPill>>())
  // A new scope's counts are not in yet: keep each dot as it was.
  const mentions = AsyncResult.isSuccess(counts) ? new Set(counts.value.viewMentions) : new Set(held?.filter((pill) => pill.mention).map((pill) => pill.id))
  return get(viewsAtom).map((view) => ({ id: view.id, name: view.name, ...(view.icon === undefined ? {} : { icon: view.icon }), ...(view.color === undefined ? {} : { color: view.color }), mention: mentions.has(view.id) }))
}).pipe(Atom.withEquality(samePills))

/** The view sheet (inventory 2.3): closed, a new view (maybe with a conversation in it already), editing a view, or editing Channels', DMs' or Reactions' look. */
export type ViewSheetState =
  | { readonly mode: 'new'; readonly channels: ReadonlyArray<Pick<ChannelRef, 'id' | 'name' | 'kind'>> }
  | { readonly mode: 'edit'; readonly id: string }
  | { readonly mode: 'pill'; readonly id: BuiltinPill }

export const viewSheetAtom = Atom.make<ViewSheetState | undefined>(undefined).pipe(Atom.keepAlive)
