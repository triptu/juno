/**
 * Sidebar views (SPEC 5 "Views", inventory 2.3, 15.7 and 15.8): picking a
 * view, the pill's menu, reordering, the sheet's save, and Add to view on a
 * channel's or DM's menu. Delete, add and remove keep the undo the engine
 * returned and show a toast with Undo.
 */
import {
  dropViewOrder,
  moveViewOrder,
  isBuiltinPill,
  viewMenuChoice,
  viewPillMenuItems,
  viewsAddChannel,
  viewsDelete,
  viewsRemoveChannel,
  viewsReorder,
  viewsSave,
  type ChannelRef,
  type KindFilter,
  type ViewChoice,
  type ViewDraft,
  type ViewMenuAction,
  type ViewPillAction,
} from '@juno/contract'
import { pillOrderAtom, popupContextMenu, registry, runAction, runCommand, savePillOrder, sidebarFilterAtom, sidebarPaneAtom, viewSheetAtom, viewsAtom } from '@juno/state'
import { Exit } from 'effect'
import { startTransition } from 'react'
import { markFilterChange } from './filterMark'
import { nativeMenu } from './notifyActions'

/** A conversation as a menu knows it. */
export type ViewChannel = Pick<ChannelRef, 'id' | 'kind' | 'name' | 'label'>

/** Puts the topic list back in place of the Reactions view. */
function showTopics(): void {
  if (registry.get(sidebarPaneAtom) !== 'topics') registry.set(sidebarPaneAtom, 'topics')
}

/** Selects the Reactions pill (SPEC 5, "Reactions"): its list replaces the topics until another pill is picked. */
export function selectReactions(): void {
  if (registry.get(sidebarPaneAtom) === 'reactions') return
  registry.set(sidebarPaneAtom, 'reactions')
}

/** Selects a view's pill: its list replaces the shown one, and a scope goes. */
export function selectView(id: string): void {
  showTopics()
  const filter = registry.get(sidebarFilterAtom)
  if (filter.view === id && filter.scope === undefined) return
  markFilterChange()
  const { scope: _scope, ...rest } = filter
  // The old rows stay until the new window arrives; never a blank list in between (performance.md 5.3).
  startTransition(() => registry.set(sidebarFilterAtom, { ...rest, view: id }))
}

/** Selects All, Channels or DMs, leaving any view. */
export function selectKind(kind: KindFilter): void {
  showTopics()
  const filter = registry.get(sidebarFilterAtom)
  if (filter.kind === kind && filter.view === undefined) return
  markFilterChange()
  const { view: _view, ...rest } = filter
  startTransition(() => registry.set(sidebarFilterAtom, { ...rest, kind }))
}

const viewOrder = () => registry.get(viewsAtom).map((view) => view.id)

/** Saves a new order of the pills after All, and the views' own order when that changed. */
function reorder(order: ReadonlyArray<string>): void {
  const views = order.filter((id) => !isBuiltinPill(id))
  const was = viewOrder()
  void savePillOrder(registry, order)
  if (views.length !== was.length || views.some((id, i) => id !== was[i])) void runCommand(registry, viewsReorder, { ids: views })
}

/** A pill after All (a view's, Channels, DMs or Reactions) dropped before another, or at the end. */
export function moveView(id: string, before: string | undefined): void {
  const order = registry.get(pillOrderAtom)
  const next = dropViewOrder(order, id, before)
  if (next !== order) reorder(next)
}

/** Deletes a view, with Undo. A selected view gives way to All. */
function deleteView(id: string): void {
  const view = registry.get(viewsAtom).find((each) => each.id === id)
  if (view === undefined) return
  if (registry.get(sidebarFilterAtom).view === id) selectKind('all')
  void runAction(registry, viewsDelete, { id }, { text: `Deleted view · ${view.name}` })
}

/** The menu on a pill after All (inventory 15.7): a view's, or Channels', DMs' or Reactions', which have no Delete and whose Edit changes only the icon and colour. */
export async function showViewPillMenu(id: string): Promise<void> {
  const order = registry.get(pillOrderAtom)
  const at = order.indexOf(id)
  if (at < 0) return
  const builtin = isBuiltinPill(id)
  const enabled = (item: ViewPillAction) => (item === 'view-left' ? at > 0 : item === 'view-right' ? at < order.length - 1 : true)
  const chosen = (await popupContextMenu(nativeMenu(viewPillMenuItems(builtin), enabled))) as ViewPillAction | undefined
  switch (chosen) {
    case 'view-edit':
      return registry.set(viewSheetAtom, builtin ? { mode: 'pill', id } : { mode: 'edit', id })
    case 'view-left':
      return reorder(moveViewOrder(order, id, -1))
    case 'view-right':
      return reorder(moveViewOrder(order, id, 1))
    case 'view-delete':
      return deleteView(id)
  }
}

/** Edit view in the empty state of a view with no conversations. */
export function editSelectedView(): void {
  const id = registry.get(sidebarFilterAtom).view
  if (id !== undefined) registry.set(viewSheetAtom, { mode: 'edit', id })
}

/** The New view pill. */
export function newView(): void {
  registry.set(viewSheetAtom, { mode: 'new', channels: [] })
}

export function closeViewSheet(): void {
  registry.set(viewSheetAtom, undefined)
}

/** The sheet's Save: a new view is selected once it exists. Resolves with whether it saved. */
export async function saveView(draft: ViewDraft): Promise<boolean> {
  const exit = await runCommand(registry, viewsSave, draft)
  if (Exit.isFailure(exit)) return false
  closeViewSheet()
  if (draft.id === undefined) selectView(exit.value.id)
  return true
}

/** Add to view's items for a conversation (inventory 15.8): every view, checked where it holds it. */
export function viewChoices(channel: string): ReadonlyArray<ViewChoice> {
  return registry.get(viewsAtom).map((view) => ({ id: view.id, name: view.name, holds: view.channels.some((c) => c.id === channel) }))
}

/** Runs an Add to view item for a conversation. */
export function runViewMenuAction(action: ViewMenuAction, channel: ViewChannel): void {
  const choice = viewMenuChoice(action)
  if (choice.kind === 'new') {
    registry.set(viewSheetAtom, { mode: 'new', channels: [channel] })
    return
  }
  const view = registry.get(viewsAtom).find((each) => each.id === choice.view)
  if (view === undefined) return
  const payload = { id: view.id, channel: channel.id }
  if (choice.kind === 'add') void runAction(registry, viewsAddChannel, payload, { text: `Added ${channel.label} to ${view.name}` })
  else void runAction(registry, viewsRemoveChannel, payload, { text: `Removed ${channel.label} from ${view.name}` })
}
