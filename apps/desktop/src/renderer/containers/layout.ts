/**
 * The sidebar's width and hidden state (spec section 4). The renderer owns
 * them; main keeps a copy in launch.json for the next launch's first render
 * and for View › Hide Sidebar's label.
 */
import { DEFAULT_SIDEBAR, type SidebarLayout } from '@juno/contract'
import { persistSidebar, registry, sidebarLayoutAtom } from '@juno/state'

function setSidebar(next: SidebarLayout): void {
  const current = registry.get(sidebarLayoutAtom)
  if (current.width === next.width && current.collapsed === next.collapsed) return
  registry.set(sidebarLayoutAtom, next)
  persistSidebar(next)
}

/** ⌃⌘S, View › Hide Sidebar and the title bar button. */
export function toggleSidebar(): void {
  const current = registry.get(sidebarLayoutAtom)
  setSidebar({ ...current, collapsed: !current.collapsed })
}

/** The end of a drag on the sidebar's edge. */
export function resizeSidebar(width: number): void {
  setSidebar({ ...registry.get(sidebarLayoutAtom), width })
}

/** A double-click on the sidebar's edge. */
export function resetSidebarWidth(): void {
  resizeSidebar(DEFAULT_SIDEBAR.width)
}

/** A drag that ends far enough left hides the sidebar and keeps its width. */
export function collapseSidebar(): void {
  setSidebar({ ...registry.get(sidebarLayoutAtom), collapsed: true })
}
