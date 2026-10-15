import type { ReactNode } from 'react'
import { sidebarLayoutAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Shell } from '@juno/views'
import { collapseSidebar, resetSidebarWidth, resizeSidebar } from './layout'
import { Toasts } from './Toasts'

/**
 * The signed-in window: the shell with the sidebar at its saved width, or
 * hidden. The panes come in as elements made by the parent, so a resize or
 * a hide re-renders this frame and not them.
 */
export function Frame({ sidebar, children }: { readonly sidebar: ReactNode; readonly children: ReactNode }) {
  const layout = useAtomValue(sidebarLayoutAtom)
  return (
    <Shell
      sidebar={sidebar}
      sidebarWidth={layout.width}
      sidebarHidden={layout.collapsed}
      onSidebarResize={resizeSidebar}
      onSidebarResetWidth={resetSidebarWidth}
      onSidebarCollapse={collapseSidebar}
      toast={<Toasts />}
    >
      {children}
    </Shell>
  )
}
