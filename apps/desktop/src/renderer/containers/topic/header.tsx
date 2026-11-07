import { useEffect, useState, type ReactNode } from 'react'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { channelTopicsAtom, headerRenamingAtom, junoAvailableAtom, junoPanelOpenAtom, personPausedAtom, personPresenceAtom, registry, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicHeader, type MenuAnchor, type TopicHeaderProps, type TopicHeaderReader } from '@juno/views'
import { chunk } from '../chunks'
import { followThread } from '../notifyActions'
import { toggleJunoPanel } from '../juno/actions'
import { scopeToChannel, showChannelMenu } from '../placeMenus'
import { readingOnly } from '../readingOnly'
import { cancelRename, renameTopic, showTopicMenu, toggleResolved } from '../topicActions'
import { topicHeaderActions } from './headerActions'

const switcher = chunk(() => import('./Switcher'))
const Switcher = switcher.component((module) => module.default)

/**
 * The topic's header: title, place pill, feature controls
 * (`topicHeaderActions`), Resolve or Follow, the Juno toggle, the native
 * menu and the switcher. Reading only, the pill, the switcher and the menu
 * alone (`showTopicMenu` keeps Open in new tab). Its state lives in the
 * topic, as a hook, so the topic renders as it did when this was inline.
 */
export function useTopicHeader(detail: TopicDetail, readOnly: boolean, drawnAll: boolean, reader?: TopicHeaderReader): ReactNode {
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
  const writes = !readingOnly()
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
    <PresenceHeader
      partnerId={detail.channel.kind === 'im' ? (detail.channel.partner?.id ?? '') : ''}
      detail={detail}
      menuOpen={menuOpen}
      onMenu={openMenu}
      onPill={() => scopeToChannel(detail.channel.id)}
      {...(writes ? { onPillMenu: () => void showChannelMenu(detail.channel) } : {})}
      {...(writes && agentOn && reader === undefined ? { juno: { open: panelOpen, onToggle: toggleJunoPanel } } : {})}
      {...(reader === undefined ? {} : { reader })}
      {...(renaming ? { rename: { onSave: (title: string) => renameTopic(detail.id, title), onCancel: cancelRename } } : {})}
      {...(writes && topicHeaderActions.length > 0 ? { actions: topicHeaderActions.map((Action, index) => <Action key={index} detail={detail} />) } : {})}
      {...(main || !writes ? {} : { onResolve: () => toggleResolved(detail.id), onFollow: () => followThread(detail) })}
      switcher={{ open: switcherOpen, onOpen: setSwitcherOpen, content: switcherOpen ? <Switcher detail={detail} onClose={() => setSwitcherOpen(false)} /> : null }}
    />
  )
}

/**
 * The header with a 1:1 DM partner's presence (SPEC 7, "Presence in a DM"),
 * whatever the sidebar setting: the engine always follows the open DMs'
 * partners. Read here, so a presence change re-renders the header alone.
 */
function PresenceHeader({ partnerId, ...props }: TopicHeaderProps & { readonly partnerId: string }) {
  const presence = useAtomValue(personPresenceAtom(partnerId))
  const paused = useAtomValue(personPausedAtom(partnerId))
  return <TopicHeader {...props} {...(presence === undefined ? {} : { presence, paused })} />
}
