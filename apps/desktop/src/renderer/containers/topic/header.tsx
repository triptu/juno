import { useEffect, useState, type ReactNode } from 'react'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { channelTopicsAtom, headerRenamingAtom, junoAvailableAtom, junoPanelOpenAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicHeader, type MenuAnchor } from '@juno/views'
import { chunk } from '../chunks'
import { followThread } from '../notifyActions'
import { toggleJunoPanel } from '../juno/actions'
import { scopeToChannel, showChannelMenu } from '../placeMenus'
import { cancelRename, renameTopic, showTopicMenu, toggleResolved } from '../topicActions'

const switcher = chunk(() => import('./Switcher'))
const Switcher = switcher.component((module) => module.default)

/**
 * The topic's header: title, place pill, Resolve or Follow, the Juno toggle, the
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
    const idle = requestIdleCallback(() => void switcher.load())
    const releases = [registry.mount(channelTopicsAtom(channel)), registry.mount(topicAtom(mainTopicOf(channel)))]
    return () => {
      cancelIdleCallback(idle)
      releases.forEach((release) => release())
    }
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
      {...(main ? {} : { onResolve: () => toggleResolved(detail.id), onFollow: () => followThread(detail) })}
      switcher={{ open: switcherOpen, onOpen: setSwitcherOpen, content: switcherOpen ? <Switcher detail={detail} onClose={() => setSwitcherOpen(false)} /> : null }}
    />
  )
}
