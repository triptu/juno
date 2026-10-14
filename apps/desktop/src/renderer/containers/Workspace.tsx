import { Activity, useEffect } from 'react'
import type { TopicDetail } from '@juno/contract'
import { currentPlace, mountedTabs, onMenuCommand, sidebarLayoutAtom, tabsAtom, tabStripAtom, type TabSummary } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicArt, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab, type WorkspaceTabIcon } from '@juno/views'
import { closeTabById, openNewTab, runMenuCommand, showTabMenu, stepTabHistory, switchToTab } from './navigation'
import { TitlebarNav } from './TitlebarNav'
import { hasArt, TopicTab } from './TopicView'

const kindIcons: Record<TopicDetail['channel']['kind'], WorkspaceTabIcon> = {
  public: 'hash',
  private: 'lock',
  im: 'user',
  mpim: 'users',
}

const tabs = new WeakMap<TabSummary, WorkspaceTab>()

/** A tab as the strip draws it: the topic title, or the channel name for Main, with the topic's art in the icon slot. */
function stripTab(summary: TabSummary): WorkspaceTab {
  const held = tabs.get(summary)
  if (held !== undefined) return held
  const { detail, place } = summary
  const base = { id: summary.id, pinned: summary.pinned, stealth: summary.stealth }
  const tab: WorkspaceTab =
    place.kind === 'newChat'
      ? { ...base, title: 'New chat', icon: 'new-chat' }
      : {
          ...base,
          title: detail == null ? '' : detail.kind === 'main' ? detail.channel.name : detail.title,
          icon: detail == null ? 'hash' : kindIcons[detail.channel.kind],
          unread: detail != null && detail.unreadCount > 0,
          ...(detail != null && hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={16} /> } : {}),
        }
  tabs.set(summary, tab)
  return tab
}

function selectTab(id: string, _event: ActivateEvent): void {
  switchToTab(id)
}

function tabMenu(id: string): void {
  void showTabMenu(id)
}

/** The mouse's back and forward buttons. */
function onMouseUp(event: MouseEvent): void {
  if (event.button === 3) stepTabHistory(-1)
  else if (event.button === 4) stepTabHistory(1)
}

/**
 * The tab strip and the open tabs. The active tab and the 4 most recently
 * active stay mounted in `<Activity>` (performance 4.3), so a switch is a
 * display toggle; older tabs unmount and come back at their scroll
 * snapshot. A tab's topic is keyed by its id, so Back and Forward mount the
 * topic they bring back. A New chat tab, and no tab at all, show the empty
 * workspace. While the sidebar is hidden the strip starts with its
 * controls.
 */
export function Workspace() {
  const state = useAtomValue(tabsAtom)
  const strip = useAtomValue(tabStripAtom)
  const sidebarHidden = useAtomValue(sidebarLayoutAtom, (layout) => layout.collapsed)
  const mounted = mountedTabs(state)

  useEffect(() => onMenuCommand(runMenuCommand), [])
  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const topics = state.tabs.flatMap((tab) => {
    const place = currentPlace(tab)
    return mounted.has(tab.id) && place.kind === 'topic' ? [{ tab, topicId: place.topicId }] : []
  })

  return (
    <WorkspaceView
      tabs={strip.map(stripTab)}
      {...(state.active === undefined ? {} : { activeId: state.active })}
      onSelectTab={selectTab}
      onCloseTab={closeTabById}
      onNewTab={openNewTab}
      onTabContextMenu={tabMenu}
      {...(sidebarHidden ? { leading: <TitlebarNav /> } : {})}
      nothingShown={!topics.some(({ tab }) => tab.id === state.active)}
    >
      {topics.length === 0
        ? undefined
        : topics.map(({ tab, topicId }) => (
            <Activity key={tab.id} mode={tab.id === state.active ? 'visible' : 'hidden'}>
              <TopicTab key={topicId} tabId={tab.id} id={topicId} stealth={tab.stealth} />
            </Activity>
          ))}
    </WorkspaceView>
  )
}
