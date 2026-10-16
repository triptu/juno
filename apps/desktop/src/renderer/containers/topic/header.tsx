import { useEffect, useState, type ReactNode } from 'react'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { channelTopicsAtom, headerRenamingAtom, junoAvailableAtom, junoPanelOpenAtom, nowAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicHeader, TopicSwitcher as TopicSwitcherView, type MenuAnchor } from '@juno/views'
import { toggleJunoPanel } from '../juno/actions'
import { openTopic } from '../navigation'
import { scopeToChannel, showChannelMenu } from '../placeMenus'
import { cancelRename, renameTopic, showTopicMenu, toggleResolved } from '../topicActions'

/**
 * The title's topic switcher (SPEC 7): the channel's Main and threads, from
 * local queries the topic keeps live while shown, so it opens with its rows
 * in the first frame. Mounted only while open; the query text is its own.
 */
function Switcher({ detail, onClose }: { readonly detail: TopicDetail; readonly onClose: () => void }) {
  const channel = detail.channel.id
  const mainId = mainTopicOf(channel)
  const result = useAtomValue(channelTopicsAtom(channel))
  const mainUnread = useAtomValue(topicAtom(mainId), (header) => (header._tag === 'Success' ? (header.value?.unreadCount ?? 0) : 0))
  const now = useAtomValue(nowAtom)
  const [query, setQuery] = useState('')
  const window = result._tag === 'Success' ? result.value : undefined
  const threads = window === undefined ? undefined : window.order.map((id) => window.rows.get(id)!)
  const open = (id: string, event: { readonly metaKey: boolean }) => {
    onClose()
    if (id !== detail.id || event.metaKey) openTopic(id, { newTab: event.metaKey })
  }
  return (
    <TopicSwitcherView mainId={mainId} mainUnread={mainUnread} currentId={detail.id} threads={threads} now={now} query={query} onQuery={setQuery} onOpen={open} />
  )
}

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
      switcher={{ open: switcherOpen, onOpen: setSwitcherOpen, content: switcherOpen ? <Switcher detail={detail} onClose={() => setSwitcherOpen(false)} /> : null }}
    />
  )
}
