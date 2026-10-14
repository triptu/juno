import { Activity, useEffect } from 'react'
import type { TopicDetail } from '@juno/contract'
import { currentPlace, mountedTabs, onMenuCommand, sidebarLayoutAtom, tabsAtom, tabStripAtom, type Tab, type TabSummary } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicArt, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab, type WorkspaceTabIcon } from '@juno/views'
import { HomePage } from './Home'
import { closeTabById, openNewTab, runMenuCommand, showTabMenu, stepTabHistory, switchToTab } from './navigation'
import { NewChatTab } from './NewChat'
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
  const base = { id: summary.id, pinned: summary.pinned }
  const tab: WorkspaceTab =
    place.kind === 'newChat'
      ? { ...base, title: summary.chatTitle ?? 'New chat', icon: 'new-chat' }
      : place.kind === 'home'
        ? { ...base, title: 'Home', icon: 'home' }
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

/** What a tab shows. A topic is keyed by its id, so a new place in the tab mounts afresh. */
function Page({ tab }: { readonly tab: Tab }) {
  const place = currentPlace(tab)
  switch (place.kind) {
    case 'topic':
      return <TopicTab key={place.topicId} tabId={tab.id} id={place.topicId} />
    case 'newChat':
      return <NewChatTab key="new-chat" tabId={tab.id} />
    case 'home':
      return <HomePage key="home" />
  }
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
 * topic they bring back, and a New chat that sends becomes its topic in one
 * commit. With no tab open the workspace shows Home. While the sidebar is
 * hidden the strip starts with its controls.
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

  const pages = state.tabs.filter((tab) => mounted.has(tab.id))

  return (
    <WorkspaceView
      tabs={strip.map(stripTab)}
      {...(state.active === undefined ? {} : { activeId: state.active })}
      onSelectTab={selectTab}
      onCloseTab={closeTabById}
      onNewTab={openNewTab}
      onTabContextMenu={tabMenu}
      {...(sidebarHidden ? { leading: <TitlebarNav /> } : {})}
      nothingShown={state.active === undefined}
      empty={<HomePage />}
    >
      {pages.length === 0
        ? undefined
        : pages.map((tab) => (
            <Activity key={tab.id} mode={tab.id === state.active ? 'visible' : 'hidden'}>
              <Page tab={tab} />
            </Activity>
          ))}
    </WorkspaceView>
  )
}
