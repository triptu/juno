import type { ReactNode } from 'react'
import { sidebarLayoutAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Shell } from '@juno/views'
import { Channel } from './Channel'
import { Forward } from './Forward'
import { HuddleSharePicker } from './huddle/slots'
import { collapseSidebar, resetSidebarWidth, resizeSidebar } from './layout'
import { LeaveConfirmHost } from './LeaveConfirm'
import { MessageMenuHost } from './messageMenu'
import { Palette } from './Palette'
import { readingOnly } from './readingOnly'
import { Status } from './Status'
import { Toasts } from './Toasts'

/**
 * The signed-in window: the shell with the sidebar at its saved width, or
 * hidden, and the peek beside it. The panes and the peek come in as
 * elements made by the parent, so a resize or a hide re-renders this frame
 * and not them. Reading only, it has no ⌘K and none of the sheets that
 * write.
 */
export function Frame({ sidebar, peek, children }: { readonly sidebar: ReactNode; readonly peek: ReactNode; readonly children: ReactNode }) {
  const layout = useAtomValue(sidebarLayoutAtom)
  return (
    <Shell
      sidebar={sidebar}
      sidebarWidth={layout.width}
      sidebarHidden={layout.collapsed}
      onSidebarResize={resizeSidebar}
      onSidebarResetWidth={resetSidebarWidth}
      onSidebarCollapse={collapseSidebar}
      peek={peek}
      toast={<Toasts />}
      overlay={
        readingOnly() ? undefined : (
          <>
            <Palette />
            <MessageMenuHost />
            <Forward />
            <Channel />
            <Status />
            <HuddleSharePicker />
            <LeaveConfirmHost />
          </>
        )
      }
    >
      {children}
    </Shell>
  )
}
