import { Activity, useEffect } from 'react'
import type { TopicDetail } from '@juno/contract'
import { mountedTabs, onMenuCommand, tabsAtom, tabStripAtom, type TabSummary } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { TopicArt, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab, type WorkspaceTabIcon } from '@juno/views'
import { closeTopicTab, runMenuCommand, showTabMenu, switchToTab } from './navigation'
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
  const { detail } = summary
  const tab: WorkspaceTab = {
    id: summary.id,
    title: detail == null ? '' : detail.kind === 'main' ? detail.channel.name : detail.title,
    icon: detail == null ? 'hash' : kindIcons[detail.channel.kind],
    stealth: summary.stealth,
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

/**
 * The tab strip and the open topics. The active tab and the 4 most
 * recently active stay mounted in `<Activity>` (performance 4.3), so a
 * switch is a display toggle; older tabs unmount and come back at their
 * scroll snapshot. With no tab open the page shows the empty workspace.
 */
export function Workspace() {
  const state = useAtomValue(tabsAtom)
  const strip = useAtomValue(tabStripAtom)
  const mounted = mountedTabs(state)

  useEffect(() => onMenuCommand(runMenuCommand), [])

  return (
    <WorkspaceView tabs={strip.map(stripTab)} {...(state.active === undefined ? {} : { activeId: state.active })} onSelectTab={selectTab} onCloseTab={closeTopicTab} onTabContextMenu={tabMenu}>
      {state.active === undefined
        ? undefined
        : state.tabs
            .filter((tab) => mounted.has(tab.id))
            .map((tab) => (
              <Activity key={tab.id} mode={tab.id === state.active ? 'visible' : 'hidden'}>
                <TopicTab id={tab.id} stealth={tab.stealth} />
              </Activity>
            ))}
    </WorkspaceView>
  )
}
