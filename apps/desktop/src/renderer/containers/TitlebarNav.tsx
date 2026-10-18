import { activeTab, historyStateAtom, popupContextMenu, registry, sidebarLayoutAtom, tabsAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TitlebarNav as TitlebarNavView } from '@juno/views'
import { toggleSidebar } from './layout'
import { goToTabEntry, stepTabHistory } from './navigation'
import { tabKindOf } from './tabKinds'

/** A long press on Back (-1) or Forward (1): the active tab's history that way, nearest first, as in Safari. */
async function showHistoryMenu(step: 1 | -1): Promise<void> {
  const tab = activeTab(registry.get(tabsAtom))
  if (tab === undefined) return
  const items: Array<{ id: string; label: string }> = []
  for (let index = tab.history.index + step; index >= 0 && index < tab.history.entries.length && items.length < 20; index += step) {
    const place = tab.history.entries[index]!
    items.push({ id: String(index), label: tabKindOf(place).label(place) })
  }
  if (items.length === 0) return
  const chosen = await popupContextMenu(items)
  if (chosen !== undefined && registry.get(tabsAtom).active === tab.id) goToTabEntry(Number(chosen))
}

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
