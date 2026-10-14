import { historyStateAtom, sidebarLayoutAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TitlebarNav as TitlebarNavView } from '@juno/views'
import { toggleSidebar } from './layout'
import { showHistoryMenu, stepTabHistory } from './navigation'

const back = () => stepTabHistory(-1)
const forward = () => stepTabHistory(1)
const backMenu = () => void showHistoryMenu(-1)
const forwardMenu = () => void showHistoryMenu(1)

/** Hide sidebar, Back and Forward for the active tab. Re-renders only when one of them turns on or off. */
export function TitlebarNav() {
  const history = useAtomValue(historyStateAtom)
  const hidden = useAtomValue(sidebarLayoutAtom, (layout) => layout.collapsed)
  return (
    <TitlebarNavView
      sidebarHidden={hidden}
      canGoBack={history.back}
      canGoForward={history.forward}
      onToggleSidebar={toggleSidebar}
      onBack={back}
      onForward={forward}
      onBackMenu={backMenu}
      onForwardMenu={forwardMenu}
    />
  )
}
