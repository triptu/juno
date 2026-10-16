import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { channelTopicsAtom, headerRenamingAtom, junoAvailableAtom, junoPanelOpenAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicHeader, type MenuAnchor } from '@juno/views'
import { toggleJunoPanel } from '../juno/actions'
import { scopeToChannel, showChannelMenu } from '../placeMenus'
import { cancelRename, renameTopic, showTopicMenu, toggleResolved } from '../topicActions'

const loadSwitcher = () => import('./Switcher')
const Switcher = lazy(loadSwitcher)

/**
 * The topic's header: title, place pill, Resolve, the Juno toggle, the
 * native menu and the switcher. Its state lives in the topic, as a hook, so
 * the topic renders as it did when this was inline.
 */
export function useTopicHeader(detail: TopicDetail, readOnly: boolean, drawnAll: boolean): ReactNode {
  const agentOn = useAtomValue(junoAvailableAtom)
  const panelOpen = useAtomValue(junoPanelOpenAtom)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const main = detail.kind === 'main'
  // The topic's native menu, from ⋯ or a right-click on the title: ⋯ shows it open until the menu closes.
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = (at: MenuAnchor) => {
    setMenuOpen(true)
    void showTopicMenu(detail, 'header', at).finally(() => setMenuOpen(false))
  }
  const renaming = useAtomValue(headerRenamingAtom(detail.id))
  const channel = detail.channel.id
  // The switcher's queries stay live while the topic is shown, from after its first frame, so the
  // title opens the switcher with its rows in the first frame (performance 4.4).
  useEffect(() => {
    if (!drawnAll || readOnly) return undefined
    void loadSwitcher()
    const releases = [registry.mount(channelTopicsAtom(channel)), registry.mount(topicAtom(mainTopicOf(channel)))]
    return () => releases.forEach((release) => release())
  }, [drawnAll, readOnly, channel])

  return (
    <TopicHeader
      detail={detail}
      menuOpen={menuOpen}
      onMenu={openMenu}
      onPill={() => scopeToChannel(detail.channel.id)}
      onPillMenu={() => void showChannelMenu(detail.channel)}
      {...(agentOn ? { juno: { open: panelOpen, onToggle: toggleJunoPanel } } : {})}
      {...(renaming ? { rename: { onSave: (title: string) => renameTopic(detail.id, title), onCancel: cancelRename } } : {})}
      {...(main ? {} : { onResolve: () => toggleResolved(detail.id) })}
      switcher={{ open: switcherOpen, onOpen: setSwitcherOpen, content: switcherOpen ? <Suspense fallback={null}><Switcher detail={detail} onClose={() => setSwitcherOpen(false)} /></Suspense> : null }}
    />
  )
}
